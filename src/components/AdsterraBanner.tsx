import React from "react";

interface AdsterraBannerProps {
  /** The Adsterra placement key */
  placementKey?: string;
  width?: number;
  height?: number;
  className?: string;
}

export default function AdsterraBanner({
  placementKey = "YOUR_ADSTERRA_KEY",
  width = 728,
  height = 90,
  className = "",
}: AdsterraBannerProps) {
  // We use an iframe with srcDoc to safely isolate the Adsterra script.
  // Ad networks often use document.write(), which would clear the entire 
  // React application if injected directly into the DOM after load.
  const srcDoc = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { 
            margin: 0; 
            padding: 0; 
            display: flex; 
            justify-content: center; 
            align-items: center; 
            background: transparent; 
            overflow: hidden;
          }
        </style>
      </head>
      <body>
        <script type="text/javascript">
          atOptions = {
            'key' : '${placementKey}',
            'format' : 'iframe',
            'height' : ${height},
            'width' : ${width},
            'params' : {}
          };
          document.write('<scr' + 'ipt type="text/javascript" src="http' + (location.protocol === 'https:' ? 's' : '') + '://www.highperformanceformat.com/${placementKey}/invoke.js"></scr' + 'ipt>');
        </script>
      </body>
    </html>
  `;

  return (
    <div className={`flex justify-center items-center overflow-hidden bg-neutral-900/10 rounded-lg ${className}`}>
      {placementKey === "YOUR_ADSTERRA_KEY" ? (
        <div 
          style={{ width, height }} 
          className="flex items-center justify-center border border-dashed border-neutral-700 text-neutral-500 text-xs text-center p-4"
        >
          Adsterra Banner Placeholder<br/>
          (Requires Placement Key)
        </div>
      ) : (
        <iframe
          title="Ad Advertisement"
          width={width}
          height={height}
          srcDoc={srcDoc}
          frameBorder="0"
          scrolling="no"
          sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          className="max-w-full"
          style={{ width: `${width}px`, height: `${height}px` }}
        />
      )}
    </div>
  );
}
