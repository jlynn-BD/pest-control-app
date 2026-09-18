export interface SignatureSvgHandle {
  toDataURL: (callback: (base64: string) => void) => void;
}

export type SignaturePoint = { x: number; y: number };
