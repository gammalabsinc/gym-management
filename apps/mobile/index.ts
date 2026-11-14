import { registerRootComponent } from "expo";
import Constants from "expo-constants";
import { createElement } from "react";
import { App } from "./src/App";

registerRootComponent(() => createElement(App, { constants: Constants }));
