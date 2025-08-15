import { EventEmitter } from "events"


export interface WlArg {
	name: string
	type: string
	interface?: string
	summary?: string
}


export interface WlRequest {
	name: string
	type?: string
	since?: number
	deprecated_since?: number
	description?: string
	summary?: string
	args: WlArg[]
}


export interface WlEvent {
	name: string
	since?: number
	deprecated_since?: number
	description?: string
	summary?: string
	args: WlArg[]
}


export interface WlEnumEntry {
	name: string
	value: number
	description?: string
}


export interface WlEnum {
	name: string
	description?: string
	summary?: string
	entries: WlEnumEntry[]
}


export class WlInterface extends EventEmitter {
	public readonly name: string
	public readonly version: number
	public readonly description: string
	public readonly summary: string
	public readonly requests: WlRequest[]
	public readonly events: WlEvent[]
	public readonly enums: WlEnum[]

	constructor(
		name: string, version: number,
		description: string, summary: string,
		requests: WlRequest[],
		events: WlEvent[],
		enums: WlEnum[]
	) {
		super();

		this.name = name;
		this.version = version;
		this.description = description;
		this.summary = summary;
		this.requests = requests;
		this.events = events;
		this.enums = enums;
	}
}
