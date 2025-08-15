import { WlDisplay } from "./display"


export class WlSurface {
	private display: WlDisplay
	private id: number

	constructor(display: WlDisplay, id?: number) {
		this.display = display;
		this.id = id ? id : this.display.new_id();

		this.display.register(this.id, "wl_surface");
	}
}
