// Which app this build is. One code base, four apps (plus "all" = everything, the default for
// development and the existing web deploy): set with `--mode customer|vendor|rider|admin`
// (see package.json). vite.config.js turns the mode into import.meta.env.VITE_APP.
//
// customer  the storefront; no login
// vendor    shop dashboard; signs in vendors only
// rider     delivery app; signs in riders only
// admin     franchise / super admin console; signs in admins only

export const APP = import.meta.env.VITE_APP || "all";

export const APP_INFO = {
  all: { name: "DropPutt", tagline: "FOOD • GROCERY • MINI-TRUCK", start: "/", loginApp: null },
  customer: { name: "DropPutt", tagline: "FOOD • GROCERY • MINI-TRUCK", start: "/shop", loginApp: null },
  vendor: { name: "DropPutt Vendor", tagline: "SHOP DASHBOARD", start: "/vendor", loginApp: "vendor" },
  rider: { name: "DropPutt Rider", tagline: "DELIVERY PARTNER", start: "/rider", loginApp: "rider" },
  admin: { name: "DropPutt Admin", tagline: "CONTROL ROOM", start: "/admin", loginApp: "admin" },
}[APP];
