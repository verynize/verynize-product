import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

// The legacy settings screen sets html[data-ui-theme] to "light" | "dark" | "system".
function useUiTheme(): ToasterProps["theme"] {
  const read = () => (document.documentElement.dataset.uiTheme === "light" ? "light" : "dark");
  const [theme, setTheme] = useState<ToasterProps["theme"]>(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-ui-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useUiTheme();

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--foreground)",
          "--normal-border": "var(--edge)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
