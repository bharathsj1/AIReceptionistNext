import { useEffect, useRef } from "react";

const JITSI_SCRIPT = "https://meet.jit.si/external_api.js";

function loadScript() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("window not available"));
      return;
    }
    if (window.JitsiMeetExternalAPI) {
      resolve(window.JitsiMeetExternalAPI);
      return;
    }
    const existing = document.querySelector(`script[src="${JITSI_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.JitsiMeetExternalAPI));
      existing.addEventListener("error", reject);
      return;
    }
    const script = document.createElement("script");
    script.src = JITSI_SCRIPT;
    script.async = true;
    script.onload = () => resolve(window.JitsiMeetExternalAPI);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export default function JitsiEmbed({ roomName, displayName, onJoined, onReadyToClose }) {
  const containerRef = useRef(null);
  const apiRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    let api;
    const init = async () => {
      try {
        const JitsiAPI = await loadScript();
        if (!mounted || !containerRef.current) return;
        api = new JitsiAPI("meet.jit.si", {
          roomName,
          parentNode: containerRef.current,
          configOverwrite: {
            prejoinPageEnabled: true,
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
          },
          userInfo: { displayName },
        });
        api.on("videoConferenceJoined", () => onJoined?.());
        api.on("readyToClose", () => onReadyToClose?.());
        apiRef.current = api;
      } catch (err) {
        console.error("Failed to load Jitsi", err);
      }
    };
    init();
    return () => {
      mounted = false;
      try {
        apiRef.current?.dispose?.();
      } catch (err) {
        console.warn("Jitsi dispose failed", err);
      }
    };
  }, [roomName, displayName, onJoined, onReadyToClose]);

  return <div ref={containerRef} className="h-[520px] w-full rounded-2xl overflow-hidden bg-black" />;
}
