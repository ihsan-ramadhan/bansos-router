// synchronous theme bootstrap before any component renders
try {
  const t = localStorage.getItem("bansos_theme") || "dark";
  const isLight = t === "light";
  document.documentElement.classList.add(isLight ? "light" : "dark");
  document.documentElement.classList.remove(isLight ? "dark" : "light");
} catch {}

import { render } from "preact";
import { App } from "./App";
import "./styles/index.css";

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
