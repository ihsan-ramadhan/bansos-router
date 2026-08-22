/// <reference types="vite/client" />

declare global {
  interface RequestInit {
    duplex?: "half" | "full";
  }
}
