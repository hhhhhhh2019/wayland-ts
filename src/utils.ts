import { endianness } from "os"

const oen = endianness();

export const readUInt32 =
	(b: Buffer, offset: number, en: "LE" | "BE" = oen): number =>
	en == "LE" ? b.readUint32LE(offset) : b.readUint32BE(offset);

export const writeUInt32 =
	(b: Buffer, value: number, offset: number, en: "LE" | "BE" = oen): number =>
	en == "LE" ? b.writeUint32LE(value, offset) : b.writeUint32BE(value, offset);

export const readInt32 =
	(b: Buffer, offset: number, en: "LE" | "BE" = oen): number =>
	en == "LE" ? b.readInt32LE(offset) : b.readInt32BE(offset);

export const writeInt32 =
	(b: Buffer, value: number, offset: number, en: "LE" | "BE" = oen): number =>
	en == "LE" ? b.writeInt32LE(value, offset) : b.writeInt32BE(value, offset);
