import { registerRootComponent } from "expo";
import Constants from "expo-constants";
import { createElement } from "react";
import { App } from "./src/App";
import { nativePlatform } from "./src/platform/native";

registerRootComponent(() => createElement(App, { constants: Constants, platform: nativePlatform }));
