import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { Play } from "lucide-preact";
import type { ActivityEvent, UsageStats, InFlightRequest } from "../../types";
import { diffEvents, routePath, sCurvePath, buildTripRoute, verticalBusPath, buildVerticalTripRoute, type Point } from "../../utils/routing";
import { fetchAdapters } from "../../services/api";
import { HarnessLogo } from "./HarnessLogo";
import { CourierMotor } from "./CourierMotor";
import { formatCount, formatExact } from "../../utils/format";
interface GuideLine {
  d: string;
  upstream?: string;
}
interface LiveRoutingProps {
  events: ActivityEvent[];
  inFlight?: InFlightRequest[];
  usage: UsageStats | null;
  loading: boolean;
  error: string | null;
}

interface UpstreamNode {
  name: string;
  requests: number;
}

const DEFAULT_UPSTREAMS = ["zen", "kilo", "llm7", "ovh"];
const OUTBOUND_MS = 2000;
const RETURN_MS = 2000;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function supportsOffsetPath(): boolean {
  if (typeof CSS === "undefined" || !CSS.supports) return false;
  if (typeof Promise.withResolvers !== "function") return false;
  return CSS.supports("offset-path", 'path("M 0 0 L 10 0")');
}

function routeLabel(event: ActivityEvent): string {
  const origin = event.client ? `${event.client} → ` : "";
  const target = event.failoverFrom ? `${event.upstream}, failover from ${event.failoverFrom}` : event.upstream;
  const code = event.statusCode ? ` ${event.statusCode}` : "";
  const seconds = event.durationMs >= 1000 ? `${(event.durationMs / 1000).toFixed(1)}s` : `${event.durationMs}ms`;
  return `${origin}${event.model} to ${target}${code} in ${seconds}`;
}

function relativeRect(el: Element | null, stage: DOMRect): { left: number; top: number; right: number; bottom: number; cx: number; cy: number } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const left = r.left - stage.left;
  const top = r.top - stage.top;
  return { left, top, right: left + r.width, bottom: top + r.height, cx: left + r.width / 2, cy: top + r.height / 2 };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function edgePoint(from: Point, box: { left: number; top: number; right: number; bottom: number; cx: number; cy: number }): Point {
  const dx = box.cx - from.x;
  const dy = box.cy - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? box.left : box.right, y: box.cy };
  }
  return { x: box.cx, y: dy >= 0 ? box.top : box.bottom };
}

export function LiveRouting({ events, inFlight, usage, loading, error }: LiveRoutingProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const courierRef = useRef<HTMLDivElement | null>(null);
  const seenRef = useRef<Set<number>>(new Set());
  const seenInFlightRef = useRef<Set<number>>(new Set());
  const maxTsRef = useRef(0);
  const seededRef = useRef(false);
  const queueRef = useRef<ActivityEvent[]>([]);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);
  const lastEventRef = useRef<ActivityEvent | null>(null);
  const animationRef = useRef<Animation | null>(null);
  const tripSeqRef = useRef(0);

  const [path, setPath] = useState("");
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const [trip, setTrip] = useState<ActivityEvent | null>(null);
  const [activeUpstream, setActiveUpstream] = useState<string | null>(null);
  const [lastRoutedUpstream, setLastRoutedUpstream] = useState<string | null>(() => {
    if (!events.length) return null;
    const newest = events.reduce<ActivityEvent | null>(
      (best, e) => (!best || e.timestamp > best.timestamp ? e : best),
      null,
    );
    return newest?.upstream ?? null;
  });
  const [isReturning, setIsReturning] = useState(false);
  const [liveText, setLiveText] = useState("Waiting for the first request in this window.");
  const [detectedHarnesses, setDetectedHarnesses] = useState<string[]>([]);
  const reducedMotion = useRef(prefersReducedMotion());
  const canTravel = useRef(supportsOffsetPath());

  const upstreams = useMemo<UpstreamNode[]>(() => {
    const counts = usage?.perUpstream ?? {};
    const known = new Set(DEFAULT_UPSTREAMS);
    const list: UpstreamNode[] = DEFAULT_UPSTREAMS.map((name) => ({
      name,
      requests: counts[name]?.requests ?? 0,
    }));
    for (const [name, u] of Object.entries(counts)) {
      if (!known.has(name)) {
        list.push({ name, requests: u.requests });
      }
    }
    const target = trip?.upstream;
    if (target && !list.some((r) => r.name === target)) {
      list.push({ name: target, requests: 0 });
    }
    return list;
  }, [usage, trip]);

  useEffect(() => {
    fetchAdapters()
      .then((adapters) => {
        const configured = adapters
          .filter((a) => a.status === "configured")
          .map((a) => a.name);
        if (configured.length > 0) {
          setDetectedHarnesses(configured);
        } else {
          const present = adapters
            .filter((a) => a.status !== "missing")
            .map((a) => a.name);
          if (present.length > 0) setDetectedHarnesses(present);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      reducedMotion.current = media?.matches ?? false;
    };
    media?.addEventListener("change", onChange);
    return () => {
      mountedRef.current = false;
      media?.removeEventListener("change", onChange);
      animationRef.current?.cancel();
    };
  }, []);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const draw = () => {
      const box = stage.getBoundingClientRect();
      const harness = relativeRect(stage.querySelector("[data-node='harness']"), box);
      const router = relativeRect(stage.querySelector("[data-node='router']"), box);
      if (!harness || !router) return;
      const isVertical = router.top > harness.bottom - 5;
      const next: GuideLine[] = [];
      if (!isVertical) {
        next.push({
          d: routePath([
            { x: harness.right, y: harness.cy },
            { x: router.left, y: router.cy },
          ]),
        });
        for (const row of upstreams) {
          const target = relativeRect(stage.querySelector(`[data-upstream="${cssEscape(row.name)}"]`), box);
          if (!target) continue;
          next.push({
            upstream: row.name,
            d: sCurvePath(
              { x: router.right, y: router.cy },
              edgePoint({ x: router.right, y: router.cy }, target),
            ),
          });
        }
      } else {
        next.push({
          d: `M ${round(harness.cx)} ${round(harness.bottom)} L ${round(router.cx)} ${round(router.top)}`,
        });
        const busX = Math.max(16, Math.min(26, router.left - 16));
        for (const row of upstreams) {
          const target = relativeRect(stage.querySelector(`[data-upstream="${cssEscape(row.name)}"]`), box);
          if (!target) continue;
          next.push({
            upstream: row.name,
            d: verticalBusPath(
              { x: router.cx, y: router.bottom },
              busX,
              { x: target.left, y: target.cy },
            ),
          });
        }
      }
      setGuides(next);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [upstreams, loading, error]);

  useEffect(() => {
    if (!inFlight || inFlight.length === 0) return;
    for (const req of inFlight) {
      if (!seenInFlightRef.current.has(req.id)) {
        seenInFlightRef.current.add(req.id);
        enqueue({
          id: req.id,
          timestamp: req.timestamp,
          kind: "chat",
          model: req.model,
          requestedModel: req.requestedModel,
          upstream: req.upstream,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: 0,
          status: "ok",
          client: req.client,
        });
      }
    }
  }, [inFlight]);

  useEffect(() => {
    if (!events.length) return;
    const maxTs = events.reduce((max, e) => Math.max(max, e.timestamp), 0);
    if (!seededRef.current) {
      for (const e of events) seenRef.current.add(e.id);
      maxTsRef.current = maxTs;
      seededRef.current = true;
      rememberLatest(events);
      return;
    }
    const { fresh, seed } = diffEvents(events, seenRef.current, maxTsRef.current);
    for (const e of events) seenRef.current.add(e.id);
    maxTsRef.current = Math.max(maxTsRef.current, maxTs);
    if (seed) {
      queueRef.current = [];
      rememberLatest(events);
      return;
    }
    for (const e of fresh) enqueue(e);
  }, [events]);

  function rememberLatest(batch: ActivityEvent[]) {
    const newest = batch.reduce<ActivityEvent | null>(
      (best, e) => (!best || e.timestamp > best.timestamp ? e : best),
      null,
    );
    if (!newest) return;
    lastEventRef.current = newest;
    setLastRoutedUpstream(newest.upstream);
    setLiveText(routeLabel(newest));
  }

  function enqueue(event: ActivityEvent) {
    lastEventRef.current = event;
    if (queueRef.current.length >= 2) queueRef.current.shift();
    queueRef.current.push(event);
    void pump();
  }

  async function pump() {
    if (runningRef.current) return;
    runningRef.current = true;
    while (queueRef.current.length > 0 && mountedRef.current) {
      const next = queueRef.current.shift();
      if (next) await runTrip(next);
    }
    runningRef.current = false;
  }

  async function runTrip(event: ActivityEvent) {
    lastEventRef.current = event;
    setTrip(event);
    setLiveText(`Sending ${event.model} to ${event.upstream}...`);

    if (document.hidden) return;
    await nextFrame();

    const stage = stageRef.current;
    if (!stage) return;
    const box = stage.getBoundingClientRect();
    const harness = relativeRect(stage.querySelector("[data-node='harness']"), box);
    const router = relativeRect(stage.querySelector("[data-node='router']"), box);
    const target = relativeRect(stage.querySelector(`[data-upstream="${cssEscape(event.upstream)}"]`), box);
    if (!harness || !router || !target) return;

    const hCenter: Point = { x: harness.cx, y: harness.cy };
    const hExit: Point = { x: harness.right, y: harness.cy };
    const rEntry: Point = { x: router.left, y: router.cy };
    const rCenter: Point = { x: router.cx, y: router.cy };
    const rExit: Point = { x: router.right, y: router.cy };
    const isVertical = router.top > harness.bottom - 5;
    let d = "";
    if (!isVertical) {
      const hCenter: Point = { x: harness.cx, y: harness.cy };
      const rCenter: Point = { x: router.cx, y: router.cy };
      const rExit: Point = { x: router.right, y: router.cy };
      const arrival = edgePoint(rExit, target);
      d = buildTripRoute(hCenter, rCenter, rExit, arrival);
    } else {
      const busX = Math.max(16, Math.min(26, router.left - 16));
      d = buildVerticalTripRoute(
        { x: harness.cx, y: harness.cy },
        { x: harness.cx, y: harness.bottom },
        { x: router.cx, y: router.top },
        { x: router.cx, y: router.cy },
        { x: router.cx, y: router.bottom },
        busX,
        { x: target.left, y: target.cy },
      );
    }
    setPath(d);

    if (reducedMotion.current || !canTravel.current) {
      setActiveUpstream(event.upstream);
      await wait(1800);
      setActiveUpstream(null);
      setLiveText(routeLabel(event));
      return;
    }

    await nextFrame();
    const courier = courierRef.current;
    if (!courier) return;

    const seq = ++tripSeqRef.current;
    setIsReturning(false);
    courier.style.opacity = "1";

    animationRef.current?.cancel();
    const outboundAnim = courier.animate(
      [
        { offsetDistance: "0%", opacity: 0 },
        { offsetDistance: "12%", opacity: 1, offset: 0.12 },
        { offsetDistance: "40%", opacity: 1, offset: 0.4 },
        { offsetDistance: "50%", opacity: 0 },
      ],
      { duration: OUTBOUND_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    animationRef.current = outboundAnim;
    await outboundAnim.finished.catch(() => undefined);
    if (!mountedRef.current || tripSeqRef.current !== seq) return;

    courier.style.opacity = "0";
    setActiveUpstream(event.upstream);
    setLiveText(`Streaming from ${event.upstream}...`);
    let stayMs = Math.max(1600, event.durationMs || 1600);
    stayMs = Math.min(stayMs, 5000);
    await wait(stayMs);
    if (!mountedRef.current || tripSeqRef.current !== seq) return;

    setIsReturning(true);
    setLiveText(routeLabel(event));
    const returnAnim = courier.animate(
      [
        { offsetDistance: "50%", opacity: 0 },
        { offsetDistance: "60%", opacity: 1, offset: 0.6 },
        { offsetDistance: "88%", opacity: 1, offset: 0.88 },
        { offsetDistance: "100%", opacity: 0 },
      ],
      { duration: RETURN_MS, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
    );
    animationRef.current = returnAnim;
    await returnAnim.finished.catch(() => undefined);
    if (!mountedRef.current || tripSeqRef.current !== seq) return;
    tripSeqRef.current++;
    setLastRoutedUpstream(event.upstream);
    setActiveUpstream(null);
    setIsReturning(false);
    setPath("");
    courier.style.opacity = "0";
  }
  function replay() {
    const last = lastEventRef.current;
    if (!last) return;
    queueRef.current = [last];
    void pump();
  }

  const activeEvent = trip || lastEventRef.current;
  const activeHarness = activeEvent?.client
    ? activeEvent.client.toLowerCase()
    : activeEvent?.kind === "anthropic"
      ? "claude-code"
      : activeEvent?.kind === "responses"
        ? "codex"
        : "pi";
  const harnessDisplayName = activeHarness;
  const requestedModelLabel = activeEvent?.requestedModel || activeEvent?.model || "ready";

  const hasRoutes = !loading && !error && events.length > 0;
  const footerText = error
    ? "No route to show."
    : hasRoutes
      ? liveText
      : "No requests in this window yet. Send one through your harness.";
  return (
    <section className="rounded-xl border border-[#1c1f2b] bg-[#10121a] shadow-xs overflow-hidden">
      <div className="px-3 sm:px-4 py-3 border-b border-[#1c1f2b] flex items-start sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold text-white">Live routing</h3>
          <p className="text-[11px] text-[#8b8b96] mt-0.5">
            One courier per request: harness to router to upstream, and back.
          </p>
        </div>
        <button
          type="button"
          onClick={replay}
          disabled={!lastEventRef.current}
          className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg bg-[#131620] border border-[#1c1f2b] text-[11px] text-[#d4d4d8] hover:text-white hover:border-[#2b334a] transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563eb]"
        >
          <Play className="h-3 w-3" aria-hidden="true" />
          <span>Replay</span>
        </button>
      </div>

      <div
        ref={stageRef}
        className="relative px-3 sm:px-4 py-4 sm:py-4 min-h-68 sm:min-h-44"
        aria-busy={loading ? "true" : undefined}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full z-0" aria-hidden="true">
          {guides.map((g) => {
            if (activeUpstream && g.upstream === activeUpstream) return null;
            const isLastRoute = !activeUpstream && g.upstream && g.upstream === lastRoutedUpstream;
            const lineClass = isLastRoute ? "route-line-last" : "route-line";
            return <path key={g.d} d={g.d} className={lineClass} fill="none" strokeWidth={isLastRoute ? 1.75 : 1.25} />;
          })}
          {path && <path d={path} className="route-line route-line-active" fill="none" strokeWidth={2.25} />}
        </svg>

        <div className="relative z-20 flex flex-col sm:flex-row items-center sm:justify-between w-full max-w-5xl mx-auto px-2 sm:px-6 gap-6 sm:gap-6">
          <div className="flex justify-center sm:justify-start w-full sm:w-auto">
            <div
              data-node="harness"
              className="rounded-2xl border border-[#1c1f2b] bg-[#10121a] p-3 sm:p-3.5 w-48 sm:w-36 min-h-24 sm:min-h-29 flex flex-col items-center justify-center text-center shadow-xs"
            >
              <div className="mb-1 sm:mb-2">
                <HarnessLogo name={activeHarness} className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
              <span className="text-xs font-bold text-white font-mono truncate max-w-35 sm:max-w-none">
                {harnessDisplayName}
              </span>
              <span className="text-[10px] text-[#8b8b96] font-mono truncate mt-0.5 sm:mt-1 max-w-35 sm:max-w-27.5" title={requestedModelLabel}>
                {requestedModelLabel}
              </span>
            </div>
          </div>

          <div className="flex justify-center w-full sm:w-auto">
            <div
              data-node="router"
              className="rounded-2xl border border-[#2563eb]/40 bg-[#10121a] p-3 sm:p-3.5 w-52 sm:w-40 min-h-24 sm:min-h-29 flex flex-col items-center justify-center text-center shadow-[0_0_15px_rgba(37,99,235,0.08)]"
            >
              <img src="/favicon.png" alt="bansos-router" className="h-6 w-6 sm:h-7 sm:w-7 rounded-md border border-[#2e2e38] mb-1 sm:mb-2" />
              <span className="text-xs font-bold text-white font-mono">bansos-router</span>
              <span className="text-[10px] text-[#8b8b96] font-mono mt-0.5">127.0.0.1:17070</span>
              <span
                className="text-[9px] px-2 py-0.5 mt-1 sm:mt-1.5 rounded-full bg-[#131620] border border-[#1e2330] text-[#a1a1aa] font-mono shadow-xs"
                title={usage ? formatExact(usage.totalRequests) : undefined}
              >
                {usage ? `${formatCount(usage.totalRequests)} req` : "routing"}
              </span>
            </div>
          </div>

          <div className="flex justify-end w-full sm:w-auto">
            <div className="flex flex-col gap-2 sm:gap-2.5 w-[calc(100%-48px)] sm:w-44 ml-auto sm:ml-0 shrink-0">
              {loading && <div className="text-[11px] text-[#8b8b96] py-2">Loading routing state...</div>}
              {!loading && error && (
                <div className="text-[11px] text-rose-400 py-2">Routing data unavailable. Retry with Refresh.</div>
              )}
              {!loading &&
                !error &&
                upstreams.map((upstream) => {
                  const isTarget = activeUpstream === upstream.name || (!activeUpstream && lastRoutedUpstream === upstream.name);
                  return (
                    <div
                      key={upstream.name}
                      data-upstream={upstream.name}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 transition-colors duration-150 ${
                        isTarget ? "border-[#2563eb] bg-[#2563eb]/15 shadow-xs" : "border-[#1c1f2b] bg-[#0c0e14]"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`h-2.5 w-2.5 rounded-full shrink-0 m-0.5 ${
                            isTarget
                              ? "bg-white ring-2 ring-[#2563eb]"
                              : "border border-[#64748b] bg-transparent"
                          }`}
                        />
                        <span className="text-[11px] font-mono text-white truncate font-medium">
                          {upstream.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-[#8b8b96] shrink-0" title={formatExact(upstream.requests)}>
                        {formatCount(upstream.requests)} req
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>

        <div
          ref={courierRef}
          className="route-courier pointer-events-none absolute left-0 top-0 h-9 w-14 opacity-0 z-10"
          style={
            {
              offsetPath: path ? `path("${path}")` : undefined,
              offsetRotate: "0deg",
              offsetAnchor: "50% 50%",
            } as Record<string, string | undefined>
          }
          aria-hidden="true"
        >
          <div className={`h-full w-full transition-transform duration-100 ${isReturning ? "courier-flip-return" : ""}`}>
            <CourierMotor />
          </div>
        </div>
      </div>

      <div className="px-3 sm:px-4 py-2.5 border-t border-[#1c1f2b] text-[11px] text-[#a1a1aa] flex items-center justify-between gap-2">
        <span className="truncate" aria-live="polite">
          {footerText}
        </span>
        {reducedMotion.current && <span className="text-[10px] text-[#8b8b96] shrink-0">motion off</span>}
      </div>
    </section>
  );
}

function wait(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}
