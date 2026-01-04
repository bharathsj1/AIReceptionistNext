import { useEffect, useRef, useState } from "react";
import { buildTaskStreamUrl, fetchTaskChanges } from "../../lib/api/tasks";

const MAX_SSE_FAILURES = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const useTaskStream = ({ enabled, email, onEvent }) => {
  const [connectionStatus, setConnectionStatus] = useState(
    enabled ? "connecting" : "disabled"
  );
  const cursorRef = useRef(null);
  const failuresRef = useRef(0);
  const eventSourceRef = useRef(null);
  const pollingRef = useRef(false);
  const onEventRef = useRef(onEvent);
  const lastEventAtRef = useRef(0);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!enabled || !email) {
      setConnectionStatus(enabled ? "idle" : "disabled");
      return undefined;
    }

    let active = true;
    let reconnectTimer = null;

    const handleEvent = (rawEvent) => {
      try {
        const payload = JSON.parse(rawEvent.data || "{}");
        if (payload?.cursor) {
          cursorRef.current = payload.cursor;
        } else if (payload?.id) {
          cursorRef.current = payload.id;
        }
        lastEventAtRef.current = Date.now();
        if (payload?.task) {
          onEventRef.current?.(payload);
        }
      } catch (error) {
        console.warn("Failed to parse task event", error);
      }
    };

    const startLongPoll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      setConnectionStatus("polling");
      while (active && pollingRef.current) {
        try {
          const response = await fetchTaskChanges({
            email,
            since: cursorRef.current,
            timeout: 25
          });
          const events = response?.events || [];
          if (events.length) {
            events.forEach((evt) => {
              if (evt?.cursor) cursorRef.current = evt.cursor;
              lastEventAtRef.current = Date.now();
              onEventRef.current?.(evt);
            });
          }
          if (response?.cursor) {
            cursorRef.current = response.cursor;
          }
        } catch (error) {
          console.warn("Task long-poll failed", error);
          await sleep(2000);
        }
      }
    };

    const connectSse = () => {
      if (!active) return;
      const lastEventAt = lastEventAtRef.current;
      if (!lastEventAt || Date.now() - lastEventAt > 30000) {
        setConnectionStatus("connecting");
      }
      const url = buildTaskStreamUrl({
        email,
        since: cursorRef.current,
        timeout: 15
      });
      const eventSource = new EventSource(url);
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        failuresRef.current = 0;
        setConnectionStatus("connected");
      };

      ["task.created", "task.updated", "task.status_changed", "task.deleted"].forEach((evt) => {
        eventSource.addEventListener(evt, handleEvent);
      });

      eventSource.addEventListener("ping", (evt) => {
        try {
          const payload = JSON.parse(evt.data || "{}");
          if (payload?.cursor) cursorRef.current = payload.cursor;
          lastEventAtRef.current = Date.now();
          setConnectionStatus("connected");
        } catch (error) {
          console.warn("Failed to parse ping", error);
        }
      });

      eventSource.onerror = () => {
        eventSource.close();
        const lastEventAt = lastEventAtRef.current;
        if (lastEventAt && Date.now() - lastEventAt < 30000) {
          failuresRef.current = 0;
        } else {
          failuresRef.current += 1;
        }
        if (failuresRef.current > MAX_SSE_FAILURES) {
          setConnectionStatus("fallback");
          startLongPoll();
          return;
        }
        const backoff = Math.min(5000, 1000 * failuresRef.current);
        reconnectTimer = setTimeout(connectSse, backoff);
      };
    };

    connectSse();

    return () => {
      active = false;
      pollingRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [enabled, email, onEvent]);

  return { connectionStatus, cursorRef };
};
