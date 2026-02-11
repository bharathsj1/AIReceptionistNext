import { useEffect, useRef } from "react";

const JITSI_SCRIPT = "https://meet.jit.si/external_api.js";
const JITSI_DOMAIN = import.meta.env.VITE_JITSI_DOMAIN || "meet.jit.si";

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
        api = new JitsiAPI(JITSI_DOMAIN, {
          roomName,
          parentNode: containerRef.current,
          configOverwrite: {
            prejoinPageEnabled: false,
            disableDeepLinking: true,
            hideConferenceSubject: true,
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_BRAND_WATERMARK: false,
            SHOW_POWERED_BY: false,
            SHOW_WATERMARK_FOR_GUESTS: false,
            SHOW_LOGO_FOR_GUESTS: false,
            HIDE_DEEP_LINKING_LOGO: true,
            DEFAULT_LOGO_URL: "",
            DEFAULT_WELCOME_PAGE_LOGO_URL: "",
            DEFAULT_WELCOME_PAGE_LOGO_LINK: "",
          },
          userInfo: { displayName },
        });
        api.on("videoConferenceJoined", () => onJoined?.());
        api.on("readyToClose", () => onReadyToClose?.());
        apiRef.current = api;

        // Extra CSS hide in-iframe watermarks/promos
        const hideBranding = () => {
          const iframe = containerRef.current?.querySelector("iframe");
          if (!iframe || !iframe.contentWindow?.document) return;
          const doc = iframe.contentWindow.document;
          const style = doc.createElement("style");
          style.innerHTML = `
            .watermark, .watermark-left, .poweredby, .brand-watermark, .ribbon { display: none !important; }
            #premeeting-screen, .premeeting-screen { display: none !important; }
          `;
          doc.head.appendChild(style);
        };
        // run once when iframe loads
        setTimeout(hideBranding, 800);
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
