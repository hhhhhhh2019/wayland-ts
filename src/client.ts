import { open_display } from "./display"
import { WlSurface } from "./surface"


const display = await open_display();

const surface = new WlSurface(display);
