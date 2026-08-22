declare global {
  interface RequestInit {
    duplex?: "half" | "full";
  }
}

export {};
