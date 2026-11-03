import { Send, Square, Image as ImageIcon, X } from "lucide-preact";
import { useRef } from "preact/hooks";

interface PlaygroundInputProps {
  userPrompt: string;
  onUserPromptChange: (val: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
  supportsVision?: boolean;
  attachedImages?: string[];
  onAttachImage?: (dataUrl: string) => void;
  onRemoveImage?: (index: number) => void;
}

export function PlaygroundInput({
  userPrompt,
  onUserPromptChange,
  onSubmit,
  onStop,
  isLoading,
  supportsVision = false,
  attachedImages = [],
  onAttachImage,
  onRemoveImage,
}: PlaygroundInputProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !onAttachImage) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onAttachImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const canSubmit = (userPrompt.trim().length > 0 || attachedImages.length > 0) && !isLoading;

  return (
    <div className="p-2.5 sm:p-3 border-t border-[#1c1f2b] bg-[#10121a]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-2"
      >
        {attachedImages.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-2 p-1.5 rounded-lg bg-[#0c0e14] border border-[#1c1f2b]">
            {attachedImages.map((img, idx) => (
              <div key={idx} className="relative group shrink-0">
                <img src={img} alt="Attached thumbnail" className="h-12 w-12 object-cover rounded-md border border-[#2a2d3d]" />
                <button
                  type="button"
                  onClick={() => onRemoveImage?.(idx)}
                  aria-label="Remove image"
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-rose-600 text-white hover:bg-rose-500 shadow-xs cursor-pointer"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="relative">
          <textarea
            value={userPrompt}
            onInput={(e) => onUserPromptChange((e.target as HTMLTextAreaElement).value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (canSubmit) {
                  onSubmit();
                }
              }
            }}
            placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
            rows={3}
            className="w-full p-2.5 sm:p-3 pr-24 sm:pr-28 bg-[#0c0e14] border border-[#1c1f2b] rounded-xl text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-[#2563eb] transition font-mono leading-relaxed resize-none"
          />
          <div className="absolute right-2 bottom-2.5 sm:right-2.5 sm:bottom-3 flex items-center gap-1.5">
            {supportsVision && onAttachImage && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach image (vision)"
                  aria-label="Attach image"
                  className="p-1.5 rounded-lg text-[#94a3b8] hover:text-white hover:bg-[#1a1d28] transition cursor-pointer shrink-0"
                >
                  <ImageIcon className="h-4 w-4" />
                </button>
              </>
            )}
            {isLoading ? (
              <button
                type="button"
                onClick={onStop}
                className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-xs font-semibold text-white transition shadow-xs cursor-pointer"
              >
                <Square className="h-3 w-3 fill-white" />
                <span>Stop</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] active:bg-[#1e40af] text-xs font-semibold text-white transition shadow-xs disabled:opacity-40 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
                <span>Send</span>
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
