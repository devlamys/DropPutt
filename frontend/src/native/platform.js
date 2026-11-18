import { Capacitor } from "@capacitor/core";

/** True inside the Android app (the Capacitor shell), false in a normal browser or installed web app. */
export const isNative = () => Capacitor.isNativePlatform();
