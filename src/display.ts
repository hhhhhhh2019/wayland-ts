import { createConnection, Socket } from "net"
import path from "path"
import { once, EventEmitter } from "events"
import { readFileSync } from "fs"
import { xml2js } from "xml-js"
import type { ElementCompact } from "xml-js"

import { readUInt32, writeUInt32, readInt32, writeString } from "./utils"
import { WlObject } from "./object"
import { WlInterface } from "./interface"
import type { WlRequest, WlEvent, WlArg, WlEnum, WlEnumEntry } from "./interface"
import { WlShm } from "./shm"
import { WlCompositor } from "./compositor"



const parse_arg = (xml): WlArg => ({
	name: xml["_attributes"]!["name"]!,
	type: xml["_attributes"]!["type"]!,
	interface: xml["_attributes"]["interface"],
	summary: xml["_attributes"]["summary"],
})


const parse_request = (xml): WlRequest => ({
	name: xml["_attributes"]!["name"]!,
	type: xml["_attributes"]!["type"],
	since: xml["_attributes"]["since"],
	deprecated_since: xml["_attributes"]["deprecated-since"],
	...(xml["description"] ? {
		description: xml["description"]["_text"],
		summary: xml["description"]["_attributes"]["summary"],
	} : {}),
	args: (
		xml["arg"] ?
		Array.isArray(xml["arg"]!) ? xml["arg"]! : [xml["arg"]!] :
		[]
	).map(parse_arg)
})


const parse_event = (xml): WlEvent => ({
	name: xml["_attributes"]!["name"]!,
	since: xml["_attributes"]["since"],
	deprecated_since: xml["_attributes"]["deprecated-since"],
	...(xml["description"] ? {
		description: xml["description"]["_text"],
		summary: xml["description"]["_attributes"]["summary"],
	} : {}),
	args: (
		xml["arg"] ?
		Array.isArray(xml["arg"]!) ? xml["arg"]! : [xml["arg"]!] :
		[]
	).map(parse_arg)
})


const parse_entry = (xml): WlEnumEntry => ({
	name: xml["_attributes"]!["name"]!,
	value: Number.parseInt(xml["_attributes"]!["value"]!),
	description: xml["_attributes"]["summary"],
})


const parse_enum = (xml): WlEnum => ({
	name: xml["_attributes"]!["name"]!,
	...(xml["description"] ? {
		description: xml["description"]["_text"],
		summary: xml["description"]["_attributes"]["summary"],
	} : {}),
	entries: (
		xml["entry"] ?
		Array.isArray(xml["entry"]!) ? xml["entry"]! : [xml["entry"]!] :
		[]
	).map(parse_entry)
})


const parse_interface = xml => {
	const name = xml["_attributes"]!["name"]!;
	const version = Number.parseInt(xml["_attributes"]!["version"]!);
	const description = xml["description"]["_text"];
	const summary = xml["description"]["_attributes"]["summary"];

	const requests =
		xml["request"] ? // if there at least one request
		Array.isArray(xml["request"]!) ? xml["request"]! : [xml["request"]!] : // if only one request wrap it into array
		[];
	const events =
		xml["event"] ?
		Array.isArray(xml["event"]!) ? xml["event"]! : [xml["event"]!] :
		[];
	const enums =
		xml["enum"] ?
		Array.isArray(xml["enum"]!) ? xml["enum"]! : [xml["enum"]!] :
		[];

	return new WlInterface(
		name,
		version,
		description,
		summary,
		requests.map(parse_request),
		events.map(parse_event),
		enums.map(parse_enum),
	);
}


const parse_protocol = (path: string) => {
	const file = readFileSync(path);
	const xml = xml2js(file.toString(), {compact:true}) as ElementCompact;
	const interfaces = xml["protocol"]!["interface"];

	return (Array.isArray(interfaces) ? interfaces : [interfaces]).map(
		parse_interface
	);
}


const parse_args = (args: Array<WlArg>, msg: Buffer) => {
	const result = [];
	let offset = 0;
	let len;

	for (let a of args) {
		switch (a["type"]!) {
			case "uint":
			case "object":
			case "enum": // maybe not just int
				result.push(readUInt32(msg, offset));
				offset += 4;
				break;

			case "int":
				result.push(readInt32(msg, offset));
				offset += 4;
				break;

			case "string":
				len = readUInt32(msg, offset);
				offset += 4;
				result.push(msg.subarray(offset, offset + len - 1).toString());
				offset += Math.floor((len + 3) / 4) * 4;
				break;

			case "array":
				len = readUInt32(msg, offset);
				offset += 4;
				result.push(msg.subarray(offset, offset + len));
				offset += Math.floor((len + 3) / 4) * 4;
				break;

			case "fd":
				throw new Error("fd argument is not supported");

			case "new_id":
				throw new Error("unreachable");
		}
	}

	return result;
}


export class WlDisplay extends EventEmitter {
	private socket: Socket
	private objects: Map<number, WlObject> = new Map()
	private interfaces: WlInterface[] = []
	public  global: {name: number, infc: string, version: number}[] = []

	public registry?: WlObject
	public shm?: WlShm
	public compositor?: WlCompositor


	constructor(sock: Socket) {
		super();

		this.socket = sock;
		this.socket.on("data", this.on_data);

		this.load("/usr/share/wayland/wayland.xml");

		this.register(new WlObject(this, this.interface("wl_display")!, 1));
		this.addListener("1 error", this.on_error);
		this.addListener("1 delete_id", id => this.objects.delete(id));
	}


	public init = async () => {
		await this.get_registry();
		await this.get_shm();
		await this.get_compositor();
	}


	public interface = (name: string) =>
		this.interfaces.find(x => x.name == name)


	public register = (obj: WlObject) => {
		this.objects.set(obj.id, obj);
	}


	public bind = (name: number, version: number, id: number) => {
		const iname = this.global.find(x => x.name == name)!.infc;

		const data = Buffer.from(new Uint8Array(
			4 + // name
			4 + // str len
			Math.floor((iname.length + 3) / 4) * 4 +
			4 + // version
			4   // id
		));

		writeUInt32(data, name, 0);
		writeString(data, iname, 4);
		writeUInt32(data, version, data.length - 8);
		writeUInt32(data, id, data.length - 4);

		const header = Buffer.from(new Uint32Array([
			this.registry!.id,
			(data.length + 8 << 16) | this.registry!.interface.request("bind")
		]).buffer);

		const msg = new Uint8Array(header.length + data.length);
		msg.set(header, 0);
		msg.set(data, header.length);

		this.socket.write(Buffer.from(msg.buffer));
	}


	private on_error = (id: number, code: number, msg: string) => {
		console.log(`Error: ${id} ${code} ${msg}`);
	}


	private on_data = (buf: Buffer) => {
		while (buf.length) {
			const id = readUInt32(buf, 0);
			const size = readUInt32(buf, 4) >> 16;
			const opcode = readUInt32(buf, 4) & 0xffff;

			const msg = buf.subarray(8, size);

			// console.log(id, size, opcode);
			// console.log(msg);

			this.on_msg(id, opcode, msg);

			buf = buf.subarray(size);
		}
	}


	private on_msg = async (id: number, opcode: number, msg: Buffer) => {
		const args = parse_args(this.objects.get(id)!.interface.events[opcode]!.args, msg);
		const ev_name = this.objects.get(id)!.interface.events[opcode]!.name;

		// console.log(`emit ${id} ${ev_name}`);

		this.emit(`${id} ${ev_name}`, ...args);
	}


	public sync = async () => {
		const id = this.new_id();

		this.register(new WlObject(this, this.interface("wl_callback")!, id));

		const wl_display_infc = this.interface("wl_display")!;

		this.socket.write(Buffer.from(new Uint32Array([
			1,
			(12 << 16) | wl_display_infc.request("sync"),
			id
		]).buffer));

		await once(this, `${id} done`);
	}


	public request = (id: number, infc: WlInterface, opcode: number, ...values) => {
		const data = [];
		let len;
		let str;
		let arr;

		let i = 0;
		for (let a of infc.requests[opcode]!.args) {
			switch (a.type) {
				case "int":
					data.push(Buffer.from(new Int32Array([values[i++]]).buffer));
					break;
				case "uint":
				case "object":
					data.push(Buffer.from(new Uint32Array([values[i++]]).buffer));
					break;
				case "string":
					str = Buffer.from(values[i++], "utf8");
					data.push(Buffer.from(new Uint32Array([str.length]).buffer));
					data.push(str);
					break;
				case "new_id":
					if (a.interface) {
						data.push(Buffer.from(new Uint32Array([values[i++]]).buffer));
					} else { // name, version, id
						len = Math.floor((values[i].length + 1 + 3) / 4) * 4;
						str = Buffer.alloc(len);
						str.set(Buffer.from(values[i++] + "\0", "utf8"), 0);
						data.push(Buffer.from(new Uint32Array([len]).buffer));
						data.push(str);

						data.push(Buffer.from(new Uint32Array([values[i++]]).buffer));
						data.push(Buffer.from(new Uint32Array([values[i++]]).buffer));
					}
					break;
				case "array":
					arr = values[i++];
					data.push(Buffer.from(new Uint32Array([arr.length]).buffer));
					data.push(arr);

					break;
			}
		}

		const header = Buffer.from(new Uint32Array([
			id,
			(data.map(x => x.length).reduce((x, y) => x + y, 0) + 8 << 16) | opcode
		]).buffer);

		const msg = Buffer.concat([
			header,
			...data
		]);

		// console.log(msg);

		this.socket.write(msg);
	}


	public load = (path: string) => {
		const interfaces = parse_protocol(path);
		this.interfaces = this.interfaces.concat(interfaces);
	}


	public new_id = (): number => {
		const ids = this.objects.keys().toArray();

		let id = 2;

		while (ids.includes(id)) {id++};

		return id;
	}


	private get_registry = async () => {
		const id = this.new_id();

		this.registry = new WlObject(this, this.interface("wl_registry")!, id);
		this.register(this.registry);

		const wl_display_infc = this.interface("wl_display")!;

		this.addListener(`${id} global`, (name: number, infc: string, version: number) => {
			console.log(`global ${name} ${infc}`);
			this.global.push({name, infc, version});
		});

		this.addListener(`${id} global_remove`, (name: number) => {
			delete this.global[this.global.findIndex(x => x.name == name)];
		});

		this.socket.write(Buffer.from(new Uint32Array([
			1,
			(12 << 16) | wl_display_infc.request("get_registry"),
			id
		]).buffer));

		await this.sync();
	}


	private get_shm = async () => {
		const id = this.new_id();
		const gshm = this.global.find(x => x.infc == "wl_shm");

		if (!gshm) throw new Error("global shm not found!");

		this.shm = new WlShm(this);

		this.register(this.shm);
		this.bind(gshm.name, gshm.version, id);
	}


	private get_compositor = async () => {
		const id = this.new_id();
		const gcompositor = this.global.find(x => x.infc == "wl_compositor");

		if (!gcompositor) throw new Error("global shm not found!");

		this.compositor = new WlCompositor(this);

		this.register(this.compositor);
		this.bind(gcompositor.name, gcompositor.version, id);
	}
}



export const open_display = async (
	spath: string = process.env["XDG_RUNTIME_DIR"] ? path.join(process.env["XDG_RUNTIME_DIR"], process.env["WAYLAND_DISPLAY"] || "wayland-0") : ""
) => {
	if (!spath)
		throw new Error("wayland socket file not specified");

	const sock = createConnection(spath);
	(async () => await once(sock, "connect"))();

	const display = new WlDisplay(sock);
	await display.init();

	return display;
}
