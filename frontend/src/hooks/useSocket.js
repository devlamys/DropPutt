import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SOCKET_URL, ensureFreshToken } from "../utils/api.js";

/**
 * One authenticated Socket.io connection for the signed-in user.
 * Returns { socket, connected }. `on(event, handler)` subscriptions are kept
 * in sync with the latest handlers without reconnecting.
 *
 * The access token lives 15 minutes, so the auth callback refreshes it before
 * every (re)connect, and a server-side disconnect for an expired token
 * triggers a reconnect.
 */
export function useSocket(handlers) {
  const [state, setState] = useState({ socket: null, connected: false });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const socket = io(SOCKET_URL, {
      auth: (callback) => {
        ensureFreshToken().then((token) => callback({ token }));
      },
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 10_000,
    });

    const events = Object.keys(handlersRef.current || {});
    for (const event of events) {
      socket.on(event, (payload) => handlersRef.current?.[event]?.(payload));
    }

    socket.on("connect", () => setState({ socket, connected: true }));
    socket.on("disconnect", (reason) => {
      setState({ socket, connected: false });
      // The server drops sockets whose token expired; reconnect with a new one.
      if (reason === "io server disconnect") socket.connect();
    });
    setState({ socket, connected: false });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
    // Event names are fixed per page; handlers are read through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
