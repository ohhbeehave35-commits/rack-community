import { useEffect, useState } from "react";

export interface RamSample {
  at: number;
  usedMb: number | null;
  totalMb: number | null;
  limitMb: number | null;
  deviceGb: number | null;
  cores: number | null;
  visible: boolean;
}

type MemPerf = Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

type NavHint = Navigator & { deviceMemory?: number };

const toMb = (bytes: number) => bytes / (1024 * 1024);

export function sampleRam(): RamSample {
  const mem = (performance as MemPerf).memory;
  const nav = navigator as NavHint;
  return {
    at: Date.now(),
    usedMb: mem ? toMb(mem.usedJSHeapSize) : null,
    totalMb: mem ? toMb(mem.totalJSHeapSize) : null,
    limitMb: mem ? toMb(mem.jsHeapSizeLimit) : null,
    deviceGb: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: navigator.hardwareConcurrency || null,
    visible: document.visibilityState === "visible",
  };
}

export function heapRatio(s: RamSample | null) {
  if (!s?.usedMb || !s.limitMb) return null;
  return s.usedMb / s.limitMb;
}

export function heapTone(
  s: RamSample | null,
): "ok" | "warn" | "danger" | "muted" {
  const r = heapRatio(s);
  if (r == null) return "muted";
  if (r >= 0.85) return "danger";
  if (r >= 0.7) return "warn";
  return "ok";
}

export function fmtMb(n: number | null) {
  if (n == null) return "n/a";
  if (n < 10) return `${n.toFixed(1)} MB`;
  return `${Math.round(n)} MB`;
}

type Listener = (sample: RamSample, history: RamSample[]) => void;

let current: RamSample | null = null;
const history: RamSample[] = [];
const listeners = new Set<Listener>();
let timer: number | null = null;
let refCount = 0;

function emit() {
  current = sampleRam();
  history.push(current);
  if (history.length > 180) history.shift();
  const copy = history.slice();
  listeners.forEach((fn) => fn(current!, copy));
}

export function resetRamHistory() {
  history.length = 0;
  if (current) {
    history.push(current);
    listeners.forEach((fn) => fn(current!, history.slice()));
  }
}

export function retainRamMonitor() {
  refCount += 1;
  if (timer == null && typeof window !== "undefined") {
    emit();
    timer = window.setInterval(emit, 1000);
  }
  return () => {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0 && timer != null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

export function useRam() {
  const [sample, setSample] = useState<RamSample | null>(null);
  const [hist, setHist] = useState<RamSample[]>([]);
  useEffect(() => {
    const release = retainRamMonitor();
    const onSample: Listener = (s, h) => {
      setSample(s);
      setHist(h);
    };
    listeners.add(onSample);
    if (current) onSample(current, history.slice());
    return () => {
      listeners.delete(onSample);
      release();
    };
  }, []);
  return { sample, history: hist };
}
