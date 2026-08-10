'use client';

export default function Marquee({ items }) {
  /* duplicate for seamless loop */
  const doubled = [...items, ...items];

  return (
    <div className="marquee-root">
      <div className="marquee-track">
        {doubled.map((item, i) => (
          <span key={i} className={`marquee-item ${item.live ? '' : 'dim'}`}>
            {item.name}
          </span>
        ))}
      </div>
    </div>
  );
}
