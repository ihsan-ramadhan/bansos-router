interface HarnessLogoProps {
  name?: string;
  className?: string;
}

export function HarnessLogo({ name = "", className = "h-8 w-8 shrink-0 object-contain rounded-md" }: HarnessLogoProps) {
  const n = name.toLowerCase();

  let src = "/favicon.png";
  let adaptClass = "";

  if (n === "omp" || n.includes("oh-my-pi") || n.includes("omp/")) {
    src = "/harnesses/omp.svg";
  } else if (n === "pi" || n.includes("pi-coding-agent") || n.startsWith("pi/")) {
    src = "/harnesses/pi.svg";
    adaptClass = "harness-icon-white-adapt";
  } else if (
    n.includes("claude-code") ||
    n.includes("claude_code") ||
    n.includes("claude-cli") ||
    n.includes("claude") ||
    n.includes("anthropic")
  ) {
    src = "/harnesses/claude-code.svg";
  } else if (n.includes("opencode")) {
    src = "/harnesses/opencode.svg";
    adaptClass = "harness-icon-black-adapt";
  } else if (n.includes("cline")) {
    src = "/harnesses/cline.svg";
    adaptClass = "harness-icon-black-adapt";
  } else if (n.includes("roo")) {
    src = "/harnesses/roo.svg";
    adaptClass = "harness-icon-white-adapt";
  } else if (n.includes("goose")) {
    src = "/harnesses/goose.svg";
    adaptClass = "harness-icon-black-adapt";
  } else if (n.includes("codex") || n.includes("openai")) {
    src = "/harnesses/codex.svg";
  } else if (n.includes("antigravity")) {
    src = "/harnesses/antigravity.svg";
  } else if (n.includes("continue")) {
    src = "/harnesses/continue.png";
  } else if (n.includes("aider")) {
    src = "/harnesses/aider.png";
  } else if (n.includes("hermes") || n.includes("nous")) {
    src = "/harnesses/hermes.svg";
    adaptClass = "harness-icon-black-adapt";
  } else if (n.includes("jcode")) {
    src = "/harnesses/jcode.svg";
    adaptClass = "harness-icon-black-adapt";
  } else if (n.includes("openclaw")) {
    src = "/harnesses/openclaw.svg";
  }

  const finalClass = adaptClass ? `${className} ${adaptClass}` : className;

  return (
    <img
      src={src}
      alt={name || "Harness icon"}
      className={finalClass}
      loading="eager"
      decoding="async"
    />
  );
}
