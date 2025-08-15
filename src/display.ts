import { createConnection, Socket } from "net"
import path from "path"
import { once, EventEmitter } from "events"
import { readFileSync } from "fs"
import { xml2js } from "xml-js"
import type { ElementCompact } from "xml-js"

import { readUInt32, writeUInt32, readInt32 } from "./utils"
import { WlInterface } from "./interface"
import type { WlRequest, WlEvent, WlArg, WlEnum, WlEnumEntry } from "./interface"



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
			case "new_id":
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
				result.push(msg.subarray(offset, offset + len).toString());
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
		}
	}

	return result;
}


export class WlDisplay extends EventEmitter {
	private socket: Socket
	private registry: number = 0
	private objects: Map<number, WlInterface> = new Map()
	private interfaces: WlInterface[] = []
	private global: {name: number, infc: string, version: number}[] = []


	constructor(sock: Socket) {
		super();

		this.socket = sock;
		this.socket.on("data", this.on_data);

		this.load("/usr/share/wayland/wayland.xml");

		this.objects.set(1, this.interfaces.find(x => x.name == "wl_display")!);
		this.addListener("1 error", this.on_error);
		this.addListener("1 delete_id", id => this.objects.delete(id));
	}


	public init = async () => {
		await this.get_registry();
	}


	public bind = (name: number, id: number) => {
		const infc = this.objects.get(this.registry)!;

		this.socket.write(Buffer.from(new Uint32Array([
			this.registry,
			(16 << 16) | infc.requests.findIndex(x => x.name == "bind"),
			name,
			id
		]).buffer));
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
		const args = parse_args(this.objects.get(id)!.events[opcode]!.args, msg);
		const ev_name = this.objects.get(id)!.events[opcode]!.name;

		console.log(`emit ${id} ${ev_name}`);

		this.emit(`${id} ${ev_name}`, ...args);
	}


	private get_registry = async () => {
		const id = this.new_id();

		this.objects.set(id, this.interfaces.find(x => x.name == "wl_registry")!);
		this.registry = id;

		const wl_display_infc = this.interfaces.find(x => x.name == "wl_display")!;

		this.addListener(`${id} global`, (name: number, infc: string, version: number) => {
			this.global.push({name, infc, version});
		});

		this.addListener(`${id} global_remove`, (name: number) => {
			delete this.global[this.global.findIndex(x => x.name == name)];
		});

		this.socket.write(Buffer.from(new Uint32Array([
			1,
			(12 << 16) | wl_display_infc.requests.findIndex(x => x.name == "get_registry"),
			id
		]).buffer));

		await this.sync();
	}

	private sync = async () => {
		const id = this.new_id();

		this.objects.set(id, this.interfaces.find(x => x.name == "wl_callback")!);

		const wl_display_infc = this.interfaces.find(x => x.name == "wl_display")!;

		this.socket.write(Buffer.from(new Uint32Array([
			1,
			(12 << 16) | wl_display_infc.requests.findIndex(x => x.name == "sync"),
			id
		]).buffer));

		// (async () => await once(this, `${id} done`))();
		await once(this, `${id} done`);
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
