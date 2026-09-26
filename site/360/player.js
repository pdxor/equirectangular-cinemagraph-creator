import * as THREE from 'three';
import stories from './stories.json';
import './player.css';

const $ = id => document.getElementById(id);
const video = $('video');
const cinema = $('cinema');
const sphere = $('sphere');
const publicUrl = 'https://equirectangular-cinemagraph-creator.netlify.app/360/';
const embed = new URLSearchParams(location.search).get('embed') === '1';
document.body.classList.toggle('is-embed', embed);
let current = -1, generation = 0, lon = 180, lat = 0, drag = null;
let renderer, camera, scene, material, videoTexture, posterTexture;
let flat = false, visible = true, dirty = true, intendedPlay = false;
let statusTimer;
const time = value => `${Math.floor((value || 0) / 60)}:${String(Math.floor((value || 0) % 60)).padStart(2, '0')}`;

function status(message, clear = false) {
  clearTimeout(statusTimer);
  $('status').textContent = message;
  if (clear) statusTimer = setTimeout(() => { $('status').textContent = ''; }, 5000);
}

function setFlat(value) {
  flat = value;
  cinema.classList.toggle('is-flat', flat);
  $('flat').textContent = flat ? '360° view' : 'Flat view';
  $('flat').setAttribute('aria-pressed', String(flat));
  $('view-badge').textContent = flat ? 'EQUIRECTANGULAR / FLAT PREVIEW' : '360° / DRAG TO EXPLORE';
  $('recenter').disabled = flat;
  dirty = true;
}

try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  sphere.append(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, 1, .1, 20);
  const geometry = new THREE.SphereGeometry(8, 64, 48);
  geometry.scale(-1, 1, 1);
  material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  scene.add(new THREE.Mesh(geometry, material));
  videoTexture = new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  new ResizeObserver(() => {
    const { width, height } = sphere.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  }).observe(sphere);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    setFlat(true);
    $('flat').disabled = true;
    status('The 360° view was interrupted. Flat playback and MP4 downloads still work; reload to restore 360°.');
  });
  renderer.setAnimationLoop(() => {
    if (!visible || document.hidden || flat || (!dirty && video.paused)) return;
    lat = THREE.MathUtils.clamp(lat, -82, 82);
    const a = THREE.MathUtils.degToRad(lat), b = THREE.MathUtils.degToRad(lon);
    camera.lookAt(Math.cos(a) * Math.cos(b), Math.sin(a), Math.cos(a) * Math.sin(b));
    renderer.render(scene, camera);
    dirty = false;
  });
} catch {
  setFlat(true);
  $('flat').disabled = true;
  status('This browser cannot display WebGL panoramas. You can play the flat preview or download the 360° MP4.');
}

new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; dirty = true; }).observe(cinema);
document.addEventListener('visibilitychange', () => { dirty = true; });

function recenter() {
  const story = stories[current];
  if (!story || !camera) return;
  lon = 360 * story.cx;
  lat = 90 - 180 * story.cy;
  camera.fov = 70;
  camera.updateProjectionMatrix();
  dirty = true;
}

function zoom(delta) {
  if (!camera) return;
  camera.fov = THREE.MathUtils.clamp(camera.fov + delta, 35, 95);
  camera.updateProjectionMatrix();
  dirty = true;
}

sphere.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  sphere.focus({ preventScroll: true });
  drag = { x: event.clientX, y: event.clientY, lon, lat };
  sphere.setPointerCapture(event.pointerId);
});
sphere.addEventListener('pointermove', event => {
  if (!drag) return;
  lon = drag.lon - (event.clientX - drag.x) * .13;
  lat = THREE.MathUtils.clamp(drag.lat + (event.clientY - drag.y) * .13, -82, 82);
  dirty = true;
});
sphere.addEventListener('pointerup', () => { drag = null; });
sphere.addEventListener('pointercancel', () => { drag = null; });
sphere.addEventListener('lostpointercapture', () => { drag = null; });
sphere.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY * .025); }, { passive: false });
sphere.addEventListener('keydown', event => {
  const actions = {
    ArrowLeft: () => { lon -= 5; }, ArrowRight: () => { lon += 5; },
    ArrowUp: () => { lat = Math.min(82, lat + 5); }, ArrowDown: () => { lat = Math.max(-82, lat - 5); },
    '+': () => zoom(-5), '=': () => zoom(-5), '-': () => zoom(5), Home: recenter,
    ' ': () => { if (video.paused) play(); else video.pause(); },
  };
  if (actions[event.key]) { event.preventDefault(); actions[event.key](); dirty = true; }
});

async function play() {
  const request = generation;
  intendedPlay = true;
  $('loading').hidden = false;
  try {
    await video.play();
    if (request !== generation) return;
    $('start').hidden = true;
  } catch (error) {
    if (request !== generation || error.name === 'AbortError') return;
    intendedPlay = false;
    $('loading').hidden = true;
    $('start').hidden = false;
    $('start-label').textContent = 'Tap to play';
    status(error.name === 'NotAllowedError' ? 'Tap play to continue with sound.' : 'Playback could not start. Try again or download the MP4.');
  }
}

function select(index, autoplay = false, updateUrl = true) {
  generation += 1;
  const request = generation;
  current = (index + stories.length) % stories.length;
  const story = stories[current];
  intendedPlay = false;
  video.pause();
  $('loading').hidden = true;
  $('start').hidden = false;
  $('start-label').textContent = 'Play with sound';
  if (renderer && !$('flat').disabled) status('');
  $('film-number').textContent = `${String(current + 1).padStart(2, '0')} / ${stories.length}`;
  $('film-title').textContent = story.title;
  $('film-location').textContent = story.location;
  $('synopsis').textContent = story.description;
  $('quality').textContent = `${story.width} × ${story.height} · 24 fps`;
  $('download').href = story.video;
  $('download').download = `${story.slug}-music-fx-360.mp4`;
  $('download').setAttribute('aria-label', `Download ${story.title} as a 360 degree MP4`);
  video.setAttribute('aria-label', story.title);
  video.poster = story.poster;
  video.src = story.video;
  video.preload = 'none';
  video.load();
  $('elapsed').textContent = '0:00';
  $('duration').textContent = '0:30';
  $('seek').value = 0;
  $('seek').max = 30;
  $('seek').setAttribute('aria-valuetext', '0:00 of 0:30');
  if (material) {
    material.map = null;
    material.needsUpdate = true;
    dirty = true;
    new THREE.TextureLoader().load(story.poster, texture => {
      if (request !== generation) { texture.dispose(); return; }
      texture.colorSpace = THREE.SRGBColorSpace;
      posterTexture?.dispose();
      posterTexture = texture;
      if (video.paused && video.currentTime === 0) {
        material.map = posterTexture;
        material.needsUpdate = true;
        dirty = true;
      }
    });
  }
  recenter();
  document.querySelectorAll('.story-card').forEach((card, i) => {
    card.setAttribute('aria-current', String(i === current));
    if (i === current) {
      const list = $('playlist');
      const top = card.offsetTop - list.offsetTop;
      if (top < list.scrollTop || top + card.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top;
    }
  });
  if (updateUrl) history.replaceState(null, '', `${location.pathname}${location.search}#${story.slug}`);
  if (autoplay) play();
}

for (const [index, story] of stories.entries()) {
  const button = document.createElement('button');
  button.className = 'story-card';
  button.setAttribute('aria-label', `Watch ${story.title}`);
  const image = document.createElement('img');
  image.src = story.cover; image.alt = ''; image.loading = 'lazy'; image.width = 75; image.height = 57;
  const info = document.createElement('span');
  const meta = document.createElement('small');
  meta.textContent = `${String(index + 1).padStart(2, '0')} / 360° · 0:30`;
  const title = document.createElement('strong'); title.textContent = story.title;
  const cast = document.createElement('span'); cast.className = 'cast'; cast.textContent = story.cast.join(' & ');
  info.append(meta, title, cast); button.append(image, info);
  button.addEventListener('click', () => select(index, true));
  $('playlist').append(button);
}

video.volume = .8;
$('start').addEventListener('click', play);
$('play').addEventListener('click', () => { if (video.paused) play(); else video.pause(); });
video.addEventListener('play', () => {
  $('play').textContent = 'Ⅱ'; $('play').setAttribute('aria-label', 'Pause'); $('play').title = 'Pause'; $('start').hidden = true;
});
video.addEventListener('playing', () => {
  $('loading').hidden = true;
  if (material) { material.map = videoTexture; material.needsUpdate = true; dirty = true; }
});
video.addEventListener('loadeddata', () => {
  if (material) { material.map = videoTexture; material.needsUpdate = true; dirty = true; }
});
video.addEventListener('pause', () => {
  intendedPlay = false; $('play').textContent = '▶'; $('play').setAttribute('aria-label', 'Play'); $('play').title = 'Play'; $('loading').hidden = true;
});
video.addEventListener('waiting', () => { if (intendedPlay) $('loading').hidden = false; });
video.addEventListener('error', () => {
  $('loading').hidden = true; $('start').hidden = false;
  status('This story could not load. Check your connection, choose another story, or download the MP4.');
});
video.addEventListener('loadedmetadata', () => {
  const duration = Number.isFinite(video.duration) ? video.duration : 30;
  $('seek').max = duration; $('duration').textContent = time(duration);
});
video.addEventListener('timeupdate', () => {
  $('elapsed').textContent = time(video.currentTime); $('seek').value = video.currentTime;
  $('seek').setAttribute('aria-valuetext', `${time(video.currentTime)} of ${time(video.duration || 30)}`);
});
video.addEventListener('seeked', () => { dirty = true; });
video.addEventListener('ended', () => {
  if ($('autonext').checked && (current < stories.length - 1 || $('loop').checked)) {
    select(current + 1, true);
  } else {
    $('start').hidden = false; $('start-label').textContent = 'Watch again';
    status(current === stories.length - 1 ? 'You’ve reached the end of the collection. Choose a story to explore again.' : 'Story finished. Choose the next story when you’re ready.');
  }
});
$('seek').addEventListener('input', () => {
  if (video.readyState >= 1) video.currentTime = Number($('seek').value);
});
function updateVolume() {
  $('mute').textContent = video.muted || !video.volume ? 'Sound off' : 'Sound on';
  $('mute').setAttribute('aria-label', video.muted || !video.volume ? 'Unmute' : 'Mute');
  $('mute').title = $('mute').getAttribute('aria-label');
  $('volume').value = video.muted ? 0 : video.volume;
}
$('mute').addEventListener('click', () => { if (!video.volume) video.volume = .8; video.muted = !video.muted; updateVolume(); });
$('volume').addEventListener('input', () => { video.volume = Number($('volume').value); video.muted = !video.volume; updateVolume(); });
$('recenter').addEventListener('click', recenter);
$('flat').addEventListener('click', () => setFlat(!flat));
$('previous').addEventListener('click', () => select(current - 1, !video.paused));
$('next').addEventListener('click', () => select(current + 1, !video.paused));
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (cinema.requestFullscreen) await cinema.requestFullscreen();
    else status('Fullscreen is unavailable here. Open this playlist in its own tab for a larger view.');
  } catch { status('Fullscreen is unavailable here. Open this playlist in its own tab for a larger view.'); }
});
document.addEventListener('fullscreenchange', () => { $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'); dirty = true; });
$('share').addEventListener('click', async () => {
  const url = publicUrl + '#' + stories[current].slug;
  try { await navigator.clipboard.writeText(url); status('Story link copied.', true); }
  catch { status('Share this story: ' + url); }
});
function fromHash() { const index = stories.findIndex(story => `#${story.slug}` === location.hash); select(index < 0 ? 0 : index, false, false); }
window.addEventListener('hashchange', fromHash);
fromHash();

// Only the two publishing sites receive sizing messages; no media or account data is sent.
if (embed && window.parent !== window) {
  const allowedOrigins = new Set([location.origin, 'https://equirectangular-cinemagraph-creator.netlify.app', 'https://kahlilcalavas.dev', 'https://www.kahlilcalavas.dev', 'https://kahlilcalavas.netlify.app']);
  let parentOrigin;
  try { parentOrigin = new URL(document.referrer).origin; } catch { /* standalone embed */ }
  if (allowedOrigins.has(parentOrigin) || (location.hostname === 'localhost' && parentOrigin?.startsWith('http://localhost:'))) {
    new ResizeObserver(() => { window.parent.postMessage({ type: 'boxboi-360:resize', height: Math.ceil($('player-root').getBoundingClientRect().height) + 2 }, parentOrigin); }).observe($('player-root'));
  }
}
