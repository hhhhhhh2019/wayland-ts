import { WlObject } from "./object"
import { WlDisplay } from "./display"


export class WlShm extends WlObject {
	constructor(display: WlDisplay, id?: number) {
		super(display, display.interface("wl_shm")!, id ? id : display.new_id());
	}


	public create_pool = (id: number, fd: fd, size: number) => {

	}
}
