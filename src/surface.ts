import { WlDisplay } from "./display"
import { WlObject } from "./object"


export class WlSurface extends WlObject {
	constructor(display: WlDisplay, id?: number) {
		super(display, display.interface("wl_surface")!, id ? id : display.new_id());

		this.display.register(this);

		this.display.request(
			this.display.compositor!.id,
			this.display.compositor!.interface,
			this.display.compositor!.interface.request("create_surface"),
			this.id
		);
	}
}
