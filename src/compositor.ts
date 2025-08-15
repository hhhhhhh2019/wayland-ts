import { WlObject } from "./object"
import { WlDisplay } from "./display"
import { WlSurface } from "./surface"


export class WlCompositor extends WlObject {
	constructor(display: WlDisplay, id?: number) {
		super(display, display.interface("wl_compositor")!, id ? id : display.new_id());
	}
}
