import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Globe2 } from 'lucide-react';
import './story-gallery.css';

export default function StoryGallery() {
  const frame = useRef(null);
  const [height, setHeight] = useState(900);
  useEffect(() => {
    function resize(event) {
      if (event.source !== frame.current?.contentWindow || event.origin !== location.origin || event.data?.type !== 'boxboi-360:resize') return;
      if (Number.isFinite(event.data.height)) setHeight(Math.max(400, Math.min(1800, event.data.height)));
    }
    window.addEventListener('message', resize);
    return () => window.removeEventListener('message', resize);
  }, []);
  return <section className="story-gallery" id="watch" aria-labelledby="stories-title">
    <div className="story-gallery-heading"><div><div className="eyebrow"><Globe2 size={15}/> MADE WITH THE STUDIO</div><h2 id="stories-title">Small wonders.<br/><span>Whole worlds.</span></h2></div><div><p>Meet Boxboi and friends in nine 360° stories through art, architecture, and imagination. Thirty seconds each, with trip-hop and sound effects.</p><a className="text-link" href="/360/" target="_blank" rel="noreferrer">Open the full playlist <ArrowUpRight size={15}/></a></div></div>
    <iframe ref={frame} className="story-gallery-player" src="/360/?embed=1" title="Boxboi interactive 360 degree video playlist — nine stories" loading="lazy" allow="autoplay; fullscreen; clipboard-write" allowFullScreen style={{height}} />
    <p className="story-gallery-note">Drag to look around. No narration, account, or API keys needed to watch.</p>
  </section>;
}
