interface PlaygroundRawViewerProps {
  rawPayload: string | null;
  rawChunks: string[];
}

export function PlaygroundRawViewer({ rawPayload, rawChunks }: PlaygroundRawViewerProps) {
  return (
    <div className="space-y-4">
      {rawPayload && (
        <div>
          <div className="text-[10px] text-[#71717a] uppercase font-mono mb-1">
            Latest Request Payload
          </div>
          <pre className="p-3 rounded-lg bg-[#0e0e12] border border-[#23232e] text-[#93c5fd] overflow-x-auto text-[11px]">
            {rawPayload}
          </pre>
        </div>
      )}

      <div>
        <div className="text-[10px] text-[#71717a] uppercase font-mono mb-1">
          Stream Chunks ({rawChunks.length})
        </div>
        {rawChunks.length === 0 ? (
          <div className="p-4 text-center text-[#52525c] border border-dashed border-[#23232a] rounded-lg">
            No SSE chunks received yet.
          </div>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {rawChunks.map((chunk, idx) => (
              <div
                key={`chunk-${idx}-${chunk.slice(0, 16)}`}
                className="p-2 rounded bg-[#0e0e12] border border-[#23232e] text-[#a1a1aa] text-[11px] font-mono break-all"
              >
                <span className="text-[#3b82f6] select-none mr-2">[{idx + 1}]</span>
                {chunk}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
