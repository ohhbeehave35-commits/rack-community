import { useEffect, useState } from "react";
import { useDream } from "./store";

export function useDreamHydrated() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (useDream.persist.hasHydrated()) {
      setReady(true);
      return;
    }
    return useDream.persist.onFinishHydration(() => setReady(true));
  }, []);
  return ready;
}
