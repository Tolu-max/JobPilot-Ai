'use client';

import { motion } from 'framer-motion';

export default function Reveal({ children, delay = 0, y = 18, className = '', style }) {
  return (
    <motion.div
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.48, delay, ease: [0.16, 1, 0.3, 1] }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}

export function RevealStagger({ children, stagger = 0.1, y = 14, as = 'div', className = '', style }) {
  const Tag = motion[as] || motion.div;
  return (
    <Tag
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-60px' }}
      variants={{ hidden: {}, visible: { transition: { staggerChildren: stagger } } }}
      className={className}
      style={style}
    >
      {Array.isArray(children)
        ? children.map((child, i) => (
          <motion.div
            key={i}
            variants={{
              hidden: { opacity: 0, y },
              visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            {child}
          </motion.div>
        ))
        : (
          <motion.div
            variants={{
              hidden: { opacity: 0, y },
              visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            {children}
          </motion.div>
        )}
    </Tag>
  );
}
