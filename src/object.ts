import { WlDisplay } from "./display"
import { WlInterface } from "./interface"


export class WlObject {
	public display: WlDisplay
	public interface: WlInterface
	public id: number

	constructor(display: WlDisplay, infc: WlInterface, id: number) {
		this.display = display;
		this.interface = infc;
		this.id = id;
	}
}
