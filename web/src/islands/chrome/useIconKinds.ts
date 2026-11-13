import { useCallback, useState } from "react";
import { legacySelect } from "./legacy";

/** Options and value of the legacy `#icon-kind` select (Star, Heart, Check, Arrow). */
export function useIconKinds() {
  const read = () => {
    const select = legacySelect("icon-kind");
    return {
      value: select?.value ?? "star",
      options: select
        ? [...select.options].map((o) => [o.value, o.textContent ?? o.value] as const)
        : [["star", "Star"] as const],
    };
  };
  const [state, setState] = useState(read);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(() => setState(read()), []);
  return { ...state, refresh };
}
