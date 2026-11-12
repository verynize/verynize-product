// Start's lightweight Files entry. The editor entry imports these same modules later, so
// the library view, onboarding and hosted router are installed only once per page.
import "./islands/home";
import "./islands/onboarding";
import "./islands/router";
import "./islands/home/web-chrome";
export { HomeArea } from "./islands/home/route-area";
export { islandsCommitted } from "./lib/bridge";
