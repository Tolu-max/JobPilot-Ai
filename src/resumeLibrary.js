/**
 * Master Resume Library Definitions & Helpers
 *
 * Defines the fixed 4 role-specific resumes for Tolu and Sister, strictly
 * derived from their verified master career profiles.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const RESUME_PROFILES = {
  tolu: {
    'tolu-fullstack': {
      id: 'tolu-fullstack',
      candidateId: 'tolu',
      folderName: 'fullstack',
      title: 'Full Stack Web Developer',
      headline: 'Full Stack Web Developer | Laravel, PHP, JavaScript, MySQL & API Integration',
      targetRoles: [
        'full stack', 'fullstack', 'full-stack', 'laravel', 'php developer',
        'backend developer', 'web application developer', 'software engineer', 'software developer'
      ],
      targetKeywords: [
        'laravel', 'php', 'mysql', 'api', 'backend', 'full stack', 'fullstack',
        'rest api', 'database', 'payment gateway', 'paystack', 'monnify', 'crud'
      ],
      summary: 'Results-oriented Full Stack Web Developer experienced in designing, building, and deploying scalable web applications using Laravel, PHP, JavaScript, and MySQL. Proven track record developing custom fintech and e-commerce platforms (TConnect, AAIPhones), integrating payment gateways (Paystack, Monnify), architecting relational databases, and delivering clean, responsive user interfaces.',
      highlightedSkills: [
        'PHP & Laravel',
        'JavaScript (ES6+) & jQuery',
        'MySQL & Database Design',
        'RESTful API Development & Integration',
        'Payment Gateways (Paystack, Monnify)',
        'HTML5 & CSS3 / Bootstrap',
        'Git & Version Control',
        'Performance & Security Optimization'
      ],
      experience: [
        {
          company: 'Guru Web Design & SEO',
          role: 'SEO Specialist & Web Developer',
          period: '2024 – 2026',
          location: 'Remote',
          bulletPoints: [
            'Developed and customized dynamic web interfaces, integrating APIs and resolving complex technical site issues.',
            'Performed comprehensive technical website audits, fixing server-side errors, schema markup, and speed bottlenecks.',
            'Customized WordPress architectures and database structures to improve site performance and core web vitals.'
          ]
        },
        {
          company: 'AAIPhones',
          role: 'Full Stack Developer & Marketing Assistant',
          period: '2023 – 2024',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Engineered and maintained the e-commerce product catalog, inventory display, and ordering workflows with mobile-responsive design.',
            'Diagnosed and resolved backend and front-end functionality issues to ensure seamless customer checkout and transaction reliability.',
            'Integrated payment solutions and tracking APIs to streamline sales operations and automated customer notifications.',
            'Optimized server queries, asset delivery, and database indexing for improved platform speed and user experience.'
          ]
        },
        {
          company: 'Kadahive Innovation and Tech Hub',
          role: 'Lead Tutor — Summer Classes',
          period: '2023',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Trained and mentored students in web development fundamentals: HTML5, CSS3, JavaScript, and Git collaboration workflows.',
            'Guided learners through building functional projects and deploying code to live production hosting.'
          ]
        }
      ],
      projects: [
        {
          title: 'TConnect (Fintech / VTU Web Platform)',
          role: 'Founder & Lead Developer',
          technologies: 'Laravel, PHP, MySQL, JavaScript, Bootstrap, Paystack API, Monnify API',
          bulletPoints: [
            'Architected backend application logic in Laravel with relational MySQL database management and transaction logging.',
            'Integrated Monnify and Paystack payment gateway APIs for instant automated wallet funding and bill settlements.',
            'Built administrative dashboards for real-time monitoring of user accounts, transactions, and service delivery status.'
          ]
        },
        {
          title: 'AAIPhones E-Commerce Platform',
          role: 'Developer & Maintainer',
          technologies: 'PHP, JavaScript, HTML5, CSS3, Bootstrap, MySQL',
          bulletPoints: [
            'Developed dynamic product listing pages, interactive search filters, and smooth mobile-first UI components.',
            'Streamlined asset caching and script minification to achieve rapid page loads across mobile networks.'
          ]
        }
      ]
    },

    'tolu-frontend': {
      id: 'tolu-frontend',
      candidateId: 'tolu',
      folderName: 'frontend',
      title: 'Frontend / Web Developer',
      headline: 'Frontend Web Developer | JavaScript (ES6+), HTML5, CSS3, Bootstrap & Responsive UI Specialist',
      targetRoles: [
        'frontend', 'front end', 'front-end', 'ui developer', 'web developer',
        'frontend support', 'website developer', 'web implementation specialist', 'javascript developer'
      ],
      targetKeywords: [
        'javascript', 'frontend', 'front-end', 'html', 'html5', 'css', 'css3',
        'bootstrap', 'jquery', 'responsive', 'ui', 'user interface', 'ux', 'accessibility', 'web design'
      ],
      summary: 'Detail-oriented Frontend and Web Developer skilled in crafting responsive, accessible, and fast-loading web interfaces using JavaScript (ES6+), HTML5, CSS3, Bootstrap, and modern web standards. Experienced in turning functional requirements into intuitive UI components, optimizing Core Web Vitals, and maintaining cross-browser compatibility across desktop and mobile devices.',
      highlightedSkills: [
        'JavaScript (ES6+) & DOM Manipulation',
        'HTML5 Semantic Markup & Accessibility',
        'CSS3, Flexbox, Grid & Bootstrap',
        'Responsive & Mobile-First Web Design',
        'Cross-Browser Compatibility & Debugging',
        'Website Speed & Performance Optimization',
        'WordPress Theme & Frontend Customization',
        'Git Version Control & Deployment'
      ],
      experience: [
        {
          company: 'Guru Web Design & SEO',
          role: 'SEO Specialist & Web Developer',
          period: '2024 – 2026',
          location: 'Remote',
          bulletPoints: [
            'Redesigned and customized client websites using responsive HTML5/CSS3 and modern JavaScript interactions.',
            'Audited and resolved on-page structural issues, heading hierarchies, mobile usability errors, and navigation flows.',
            'Optimized web assets and styling to elevate Core Web Vitals and Google PageSpeed Insights scores.'
          ]
        },
        {
          company: 'AAIPhones',
          role: 'Full Stack Developer & Marketing Assistant',
          period: '2023 – 2024',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Designed and implemented mobile-first responsive user interfaces for product listings, category pages, and checkout workflows.',
            'Optimized client-side rendering, compressed assets, and minified scripts to achieve significant speed improvements.',
            'Resolved UI/UX defects across multiple mobile and desktop browsers to deliver a consistent, frictionless shopping experience.'
          ]
        },
        {
          company: 'Kadahive Innovation and Tech Hub',
          role: 'Lead Tutor — Summer Classes',
          period: '2023',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Taught modern frontend development principles including semantic HTML, CSS layout techniques, and JavaScript event handling.',
            'Conducted hands-on UI debugging workshops and responsive design code reviews for student projects.'
          ]
        }
      ],
      projects: [
        {
          title: 'Personal Web Developer Portfolio',
          role: 'Developer & Designer',
          technologies: 'JavaScript, HTML5, CSS3, Responsive Design, Web Performance',
          bulletPoints: [
            'Created modern, responsive personal portfolio highlighting project implementations and verified proficiencies.',
            'Achieved 95+ performance metrics on Google PageSpeed Insights through clean, dependency-light code architecture.'
          ]
        },
        {
          title: 'AAIPhones Product Interface',
          role: 'Frontend Developer',
          technologies: 'JavaScript, HTML5, CSS3, Bootstrap',
          bulletPoints: [
            'Implemented interactive filtering, image galleries, and responsive layout for hundreds of electronics catalog items.',
            'Ensured seamless mobile navigation and accessibility across iOS and Android mobile browsers.'
          ]
        }
      ]
    },

    'tolu-wordpress-seo': {
      id: 'tolu-wordpress-seo',
      candidateId: 'tolu',
      folderName: 'wordpress-seo',
      title: 'WordPress & SEO Specialist',
      headline: 'WordPress & SEO Specialist | Technical SEO, Local SEO, On-Page Optimization & Web Performance',
      targetRoles: [
        'seo specialist', 'technical seo', 'wordpress specialist', 'wordpress developer',
        'seo manager', 'on-page seo', 'local seo', 'website optimization specialist', 'seo technician'
      ],
      targetKeywords: [
        'seo', 'wordpress', 'technical seo', 'local seo', 'on-page seo', 'google business profile',
        'google analytics', 'search console', 'citations', 'keywords', 'ranking', 'backlinks', 'schema'
      ],
      summary: 'Results-driven WordPress & SEO Specialist with a verified track record managing technical, on-page, and local SEO campaigns for 20+ international clients. Expert in WordPress website administration, speed optimization, schema markup, Google Business Profile management, and structured citation building to drive measurable organic visibility and search ranking growth.',
      highlightedSkills: [
        'Technical SEO Audits & Remediation',
        'WordPress Administration & Customization',
        'On-Page SEO & Content Structure Optimization',
        'Local SEO & Google Business Profile Management',
        'Schema Markup & Structured Data',
        'Website Speed & Core Web Vitals Optimization',
        'Citation Building & Local Business Directories',
        'Search Console & Analytics Reporting'
      ],
      experience: [
        {
          company: 'Guru Web Design & SEO',
          role: 'SEO Specialist & Web Developer',
          period: '2024 – 2026',
          location: 'Remote',
          bulletPoints: [
            'Executed end-to-end technical, on-page, and local SEO strategies for 20+ international clients across multiple industries.',
            'Optimized Google Business Profiles, localized citations, and directory listings to maximize local organic search traffic.',
            'Conducted technical site audits, resolving crawl errors, 404s, redirect chains, XML sitemaps, and missing meta tags.',
            'Customized WordPress themes and plugins to improve mobile responsiveness, navigation structure, and page load speed.',
            'Generated regular organic ranking and traffic performance reports for stakeholders using search analytics.'
          ]
        },
        {
          company: 'AAIPhones',
          role: 'Full Stack Developer & Marketing Assistant',
          period: '2023 – 2024',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Implemented on-page SEO best practices across the e-commerce product catalog to increase organic discovery.',
            'Optimized product titles, descriptions, image alt tags, and internal linking structure for high-value search terms.',
            'Enhanced website performance and server response times to meet Google Core Web Vitals standards.'
          ]
        }
      ],
      projects: [
        {
          title: 'International Client SEO Optimization Portfolio',
          role: 'Lead SEO Specialist',
          technologies: 'Technical SEO, WordPress, Google Search Console, Google Business Profiles, Schema.org',
          bulletPoints: [
            'Delivered full-cycle local and technical SEO campaigns for 20+ businesses across the US, UK, and international markets.',
            'Configured structured data markup (LocalBusiness, Organization, Product schema) to enhance rich snippet indexing.'
          ]
        },
        {
          title: 'AAIPhones E-Commerce SEO Architecture',
          role: 'Web & SEO Developer',
          technologies: 'Semantic HTML5, Schema Markup, Technical SEO, WordPress',
          bulletPoints: [
            'Engineered search-friendly URL structures, canonical tags, and mobile responsive design for hundreds of product pages.',
            'Achieved improved indexing efficiency and search impressions across consumer gadget target keywords.'
          ]
        }
      ]
    },

    'tolu-ecommerce': {
      id: 'tolu-ecommerce',
      candidateId: 'tolu',
      folderName: 'ecommerce',
      title: 'E-Commerce & Web Operations Specialist',
      headline: 'E-Commerce & Web Operations Specialist | Store Maintenance, Catalog Systems, Payment APIs & Optimization',
      targetRoles: [
        'e-commerce', 'ecommerce', 'web operations', 'store manager', 'website maintenance',
        'e-commerce specialist', 'e-commerce support', 'catalog specialist', 'web support specialist'
      ],
      targetKeywords: [
        'ecommerce', 'e-commerce', 'store', 'catalog', 'product listings', 'orders',
        'payment gateway', 'inventory', 'shopify', 'woocommerce', 'maintenance', 'troubleshooting', 'web operations'
      ],
      summary: 'Practical E-Commerce & Web Operations Specialist experienced in managing online storefronts, maintaining product catalogs, integrating secure payment gateways, and troubleshooting daily web operations. Proven expertise keeping commercial platforms (AAIPhones, TConnect) fast, secure, and fully operational to maximize conversions and user satisfaction.',
      highlightedSkills: [
        'E-Commerce Store Maintenance & Operations',
        'Product Catalog & Inventory Management',
        'Payment Gateway Integration (Paystack, Monnify)',
        'Website Troubleshooting & Bug Remediation',
        'Mobile-Responsive UI & Checkout Flow Optimization',
        'Order & Transaction System Verification',
        'On-Page Product SEO & Performance Tuning',
        'Basic CMS Configuration & Updates'
      ],
      experience: [
        {
          company: 'Guru Web Design & SEO',
          role: 'SEO Specialist & Web Developer',
          period: '2024 – 2026',
          location: 'Remote',
          bulletPoints: [
            'Maintained and optimized client business websites, ensuring 99.9% uptime and smooth daily operations.',
            'Monitored website performance metrics, executed regular plugin/system updates, and resolved technical issues.',
            'Enhanced digital product pages and landing pages to support client lead generation and sales conversion.'
          ]
        },
        {
          company: 'AAIPhones',
          role: 'Full Stack Developer & Marketing Assistant',
          period: '2023 – 2024',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Maintained the commercial e-commerce storefront, updating product catalogs, pricing tiers, and promotional banners.',
            'Troubleshot and fixed operational website glitches, checkout errors, and navigation bugs in a timely manner.',
            'Integrated secure payment handling and automated customer notification systems to enhance order fulfillment.',
            'Optimized product images, page layout, and server response times to ensure fast mobile shopping experiences.'
          ]
        }
      ],
      projects: [
        {
          title: 'TConnect Transaction & Wallet Infrastructure',
          role: 'Platform Developer & Administrator',
          technologies: 'Laravel, PHP, MySQL, Payment APIs (Paystack, Monnify), Admin Dashboard',
          bulletPoints: [
            'Built real-time digital transaction and wallet funding architecture handling automated daily service delivery.',
            'Engineered administrative controls for immediate dispute resolution, transaction verification, and sales logs.'
          ]
        },
        {
          title: 'AAIPhones Commercial Storefront',
          role: 'E-Commerce Maintainer',
          technologies: 'PHP, JavaScript, HTML5/CSS3, E-Commerce Catalog, Payment Integration',
          bulletPoints: [
            'Managed catalog architecture for consumer gadgets, ensuring clear specifications, pricing, and fast mobile search.',
            'Streamlined user navigation from product discovery to checkout inquiry.'
          ]
        }
      ]
    }
  },

  sister: {
    'sister-customer-support': {
      id: 'sister-customer-support',
      candidateId: 'sister',
      folderName: 'customer-support',
      title: 'Customer Support Specialist',
      headline: 'Customer Support Specialist | Zendesk, Inbound Communications, Live Chat & Issue Resolution',
      targetRoles: [
        'customer support', 'customer service', 'support specialist', 'live chat',
        'customer experience', 'client support', 'helpdesk', 'inbound support', 'support agent'
      ],
      targetKeywords: [
        'customer support', 'customer service', 'zendesk', 'live chat', 'email support',
        'ticket', 'tickets', 'issue resolution', 'inquiries', 'customer communication', 'empathy', 'csat'
      ],
      summary: 'Empathetic and highly reliable Customer Support Specialist with proven experience managing ticket queues on Zendesk, communicating with clients across live chat and email, and resolving customer inquiries with speed and precision. Experienced in resolving billing questions, handling participant support for 1,000+ program interns, and maintaining high customer satisfaction.',
      highlightedSkills: [
        'Zendesk Ticketing & Queue Management',
        'Live Chat & Email Customer Communication',
        'Inquiry Handling & Root-Cause Resolution',
        'Order & Billing Support Inquiries',
        'Customer Retention & Follow-Up Protocols',
        'Professional & Empathetic Written Communication',
        'CRM Data Logging & Documentation',
        'Customer Satisfaction & Service Level Standards'
      ],
      experience: [
        {
          company: "D'Lite Treats and Confectioneries",
          role: 'Business Owner & Operations Manager',
          period: '2024 – Present',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Handled all customer inquiries, order consultations, and special requests promptly via chat, phone, and email.',
            'Resolved customer concerns, payment verifications, and delivery adjustments with a courteous, solution-first approach.',
            'Conducted proactive post-fulfillment follow-ups, maintaining high customer satisfaction and repeat order rates.',
            'Logged customer preferences and purchase history to provide personalized, efficient customer service.'
          ]
        },
        {
          company: 'ePrintzLab',
          role: 'Executive Assistant Intern & Program Coordinator',
          period: '2023 – 2025',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Delivered prompt, professional participant support using Zendesk, handling technical access and program questions.',
            'Assisted in managing inquiries across 5 program cohorts comprising over 1,000 interns with consistent turnaround times.',
            'Maintained clear communication logs, escalated critical blockers to leadership, and followed up to resolution.',
            'Authored helpful FAQs and onboarding guidelines that reduced repetitive support ticket volume.'
          ]
        },
        {
          company: 'Kadahive Innovation & Tech Hub',
          role: 'Intern & Content Writer',
          period: '2022 – 2023',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Provided on-site and digital attendee assistance during tech training workshops and community events.',
            'Drafted clear event reminders, community announcements, and response emails to incoming participant inquiries.'
          ]
        }
      ],
      education: [
        {
          degree: 'Bachelor of Science in Human Kinetics',
          institution: 'Ahmadu Bello University',
          year: '2025'
        }
      ]
    },

    'sister-virtual-assistant': {
      id: 'sister-virtual-assistant',
      candidateId: 'sister',
      folderName: 'virtual-assistant',
      title: 'Virtual Assistant / Administrative Specialist',
      headline: 'Virtual Assistant & Administrative Specialist | Executive Scheduling, Documentation & Office Coordination',
      targetRoles: [
        'virtual assistant', 'administrative assistant', 'executive assistant', 'operations assistant',
        'admin assistant', 'administrative coordinator', 'office assistant', 'personal assistant'
      ],
      targetKeywords: [
        'virtual assistant', 'administrative', 'admin', 'scheduling', 'calendar',
        'documentation', 'reports', 'microsoft office', 'excel', 'word', 'google workspace', 'organization', 'coordination'
      ],
      summary: 'Resourceful and organized Virtual Assistant with strong expertise in calendar scheduling, meeting coordination, document preparation, spreadsheet tracking, and administrative support. Proven success supporting program operations for 1,000+ participants at ePrintzLab and managing daily business operations with high attention to detail, confidentiality, and reliability.',
      highlightedSkills: [
        'Calendar & Executive Meeting Scheduling',
        'Administrative Coordination & Workflow Tracking',
        'Microsoft Office (Word, Excel, PowerPoint)',
        'Google Workspace (Docs, Sheets, Drive, Gmail)',
        'Document Preparation, Formatting & Proofreading',
        'Spreadsheet Data Tracking & Weekly Reporting',
        'Task Prioritization & Time Management',
        'Clear & Professional Written Communication'
      ],
      experience: [
        {
          company: 'ePrintzLab',
          role: 'Executive Assistant Intern & Program Coordinator',
          period: '2023 – 2025',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Organized executive calendars, scheduled cross-functional meetings, and prepared meeting agendas and minutes.',
            'Prepared comprehensive weekly progress reports, attendance summaries, and program documentation for management.',
            'Maintained structured digital filing systems across Google Workspace, ensuring rapid access to critical program assets.',
            'Assisted in coordinating logistical schedules and communication briefings for over 1,000 program participants.'
          ]
        },
        {
          company: "D'Lite Treats and Confectioneries",
          role: 'Business Owner & Operations Manager',
          period: '2024 – Present',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Managed daily administrative tasks including order scheduling, vendor invoicing, and supply inventory tracking.',
            'Maintained detailed Excel spreadsheets logging revenue, expenses, and customer deliveries with zero discrepancies.'
          ]
        },
        {
          company: 'Newnet Ventures Cybercafé',
          role: 'Computer Operator',
          period: '2018 – 2019',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Prepared, typed, and formatted official administrative documents, correspondence letters, and spreadsheet tables.',
            'Managed digital records, printing, scanning, and secure online portal submissions for business clients.'
          ]
        }
      ],
      education: [
        {
          degree: 'Bachelor of Science in Human Kinetics',
          institution: 'Ahmadu Bello University',
          year: '2025'
        }
      ]
    },

    'sister-crm': {
      id: 'sister-crm',
      candidateId: 'sister',
      folderName: 'crm',
      title: 'CRM & Lead Management Specialist',
      headline: 'CRM & Lead Management Specialist | HubSpot, Zendesk, Pipeline Tracking & Candidate Screening',
      targetRoles: [
        'crm specialist', 'lead management', 'lead qualification', 'pipeline coordinator',
        'operations coordinator', 'recruitment support', 'crm administrator', 'data coordinator'
      ],
      targetKeywords: [
        'crm', 'hubspot', 'zendesk', 'lead', 'leads', 'qualification', 'screening',
        'pipeline', 'candidate screening', 'data management', 'matching', 'intake', 'records'
      ],
      summary: 'Detail-driven CRM & Lead Management Specialist with extensive hands-on experience using HubSpot CRM and Zendesk to manage applicant pipelines, screen candidate qualifications, coordinate employer matching, and maintain accurate database records. Successfully managed candidate pipelines across 5 cohorts of 1,000+ participants at ePrintzLab with rigorous data integrity.',
      highlightedSkills: [
        'HubSpot CRM Database Management',
        'Zendesk Communication & Pipeline Tracking',
        'Lead & Applicant Qualification / Screening',
        'Cohort & Candidate Lifecycle Management',
        'Data Verification & Spreadsheet Accuracy',
        'Employer & Candidate Matching Coordination',
        'Workflow Optimization & Status Reporting',
        'Prompt Multi-Channel Follow-Up Communications'
      ],
      experience: [
        {
          company: 'ePrintzLab',
          role: 'Executive Assistant Intern & Program Coordinator',
          period: '2023 – 2025',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Maintained and updated participant records in HubSpot CRM across 5 program cohorts totaling 1,000+ interns.',
            'Screened candidate applications, reviewed qualifications, and supported structured matching with employer requirements.',
            'Tracked applicant pipeline progression from initial submission to placement, ensuring accurate stage updates.',
            'Utilized Zendesk to resolve participant onboarding queries and coordinate orientation milestones.',
            'Generated pipeline analytics and cohort summary reports for program stakeholders.'
          ]
        },
        {
          company: "D'Lite Treats and Confectioneries",
          role: 'Business Owner & Operations Manager',
          period: '2024 – Present',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Tracked prospective customer inquiries, converted leads into confirmed orders, and maintained customer records.',
            'Implemented follow-up workflows for corporate and celebratory inquiries, increasing conversion rates.'
          ]
        }
      ],
      education: [
        {
          degree: 'Bachelor of Science in Human Kinetics',
          institution: 'Ahmadu Bello University',
          year: '2025'
        }
      ]
    },

    'sister-ecommerce': {
      id: 'sister-ecommerce',
      candidateId: 'sister',
      folderName: 'ecommerce',
      title: 'E-Commerce & Business Operations Support',
      headline: 'E-Commerce & Business Operations Support | Order Management, Payments, Bookkeeping & Customer Support',
      targetRoles: [
        'e-commerce support', 'ecommerce support', 'operations assistant', 'business support',
        'order management', 'customer operations', 'billing support', 'store coordinator'
      ],
      targetKeywords: [
        'ecommerce', 'e-commerce', 'orders', 'order management', 'payments',
        'invoicing', 'bookkeeping', 'spreadsheets', 'customer operations', 'business support', 'inventory'
      ],
      summary: 'Practical and thorough E-Commerce & Business Operations Support Specialist with extensive experience managing customer orders, payment verifications, financial spreadsheet tracking, and client communications. Proven track record managing daily commerce workflows for D\'Lite Treats and handling administrative coordination for large-scale cohort programs.',
      highlightedSkills: [
        'End-to-End Order Processing & Fulfillment',
        'Payment Reconciliation & Invoicing Support',
        'Financial & Operational Spreadsheet Tracking (Excel)',
        'Customer Inquiries & Order Status Updates',
        'Bookkeeping & Expense / Profit Logging',
        'Inventory & Supply Tracking',
        'Problem Solving & Customer Retention Follow-Ups',
        'Cross-Functional Operational Coordination'
      ],
      experience: [
        {
          company: "D'Lite Treats and Confectioneries",
          role: 'Business Owner & Operations Manager',
          period: '2024 – Present',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Managed full cycle customer sales process: taking orders, verifying payment receipts, and confirming deliveries.',
            'Maintained comprehensive Excel spreadsheets tracking daily revenue, material expenses, profit margins, and supplier invoices.',
            'Resolved customer order inquiries, scheduling changes, and payment questions with 100% resolution rate.',
            'Established organized order tracking systems ensuring timely preparation and delivery of confectionery goods.'
          ]
        },
        {
          company: 'ePrintzLab',
          role: 'Executive Assistant Intern & Program Coordinator',
          period: '2023 – 2025',
          location: 'Remote / Hybrid',
          bulletPoints: [
            'Coordinated program documentation and logistical reporting for over 1,000 cohort participants.',
            'Managed participant correspondence and verified onboarding data integrity across spreadsheets and CRM tools.'
          ]
        },
        {
          company: 'Newnet Ventures Cybercafé',
          role: 'Computer Operator',
          period: '2018 – 2019',
          location: 'Kaduna, Nigeria',
          bulletPoints: [
            'Managed point-of-sale customer service, financial transaction records, and document processing.',
            'Maintained accurate daily transaction logs and cash reconciliations.'
          ]
        }
      ],
      education: [
        {
          degree: 'Bachelor of Science in Human Kinetics',
          institution: 'Ahmadu Bello University',
          year: '2025'
        }
      ]
    }
  }
};

/**
 * Returns list of all resume profiles for a given candidate.
 * @param {string} candidateId
 * @returns {Array}
 */
export function getCandidateResumeProfiles(candidateId) {
  const candidateKey = String(candidateId || '').toLowerCase().trim();
  const profiles = RESUME_PROFILES[candidateKey];
  return profiles ? Object.values(profiles) : [];
}

/**
 * Get a specific resume profile by candidateId and profileId/folderName.
 * @param {string} candidateId
 * @param {string} profileId
 * @returns {object|null}
 */
export function getResumeProfile(candidateId, profileId) {
  const candidateKey = String(candidateId || '').toLowerCase().trim();
  const profiles = RESUME_PROFILES[candidateKey];
  if (!profiles) return null;

  if (profiles[profileId]) return profiles[profileId];

  // Try matching by folderName (e.g. 'fullstack' instead of 'tolu-fullstack')
  for (const p of Object.values(profiles)) {
    if (p.folderName === profileId || p.id === profileId) {
      return p;
    }
  }
  return null;
}
