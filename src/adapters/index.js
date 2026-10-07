// Adapter selector: first adapter whose matches(url) returns true wins.

import bruntworkAdapter from './bruntwork.js';
import influxAdapter from './influx.js';
import jobbermanAdapter from './jobberman.js';
import applyToJobAdapter from './applytojob.js';
import remoteJobsOrgAdapter from './remotejobsorg.js';
import remoteOkAdapter from './remoteok.js';
import greenhouseAdapter from './greenhouse.js';
import leverAdapter from './lever.js';
import workableAdapter from './workable.js';
import ashbyAdapter from './ashby.js';
import bamboohrAdapter from './bamboohr.js';
import breezyHrAdapter from './breezyhr.js';
import smartRecruitersAdapter from './smartrecruiters.js';
import myjobmagAdapter from './myjobmag.js';
import himalayasAdapter from './himalayas.js';
import jobicyAdapter from './jobicy.js';
import arbeitnowAdapter from './arbeitnow.js';
import workingnomadsAdapter from './workingnomads.js';
import hotnigerianjobsAdapter from './hotnigerianjobs.js';
import indeedAdapter from './indeed.js';
import linkedinAdapter from './linkedin.js';
import genericAdapter from './generic.js';

const ADAPTERS = [
  bruntworkAdapter,
  influxAdapter,
  jobbermanAdapter,
  myjobmagAdapter,
  applyToJobAdapter,
  remoteJobsOrgAdapter,
  remoteOkAdapter,
  himalayasAdapter,
  jobicyAdapter,
  arbeitnowAdapter,
  workingnomadsAdapter,
  greenhouseAdapter,
  leverAdapter,
  workableAdapter,
  ashbyAdapter,
  bamboohrAdapter,
  breezyHrAdapter,
  smartRecruitersAdapter,
  hotnigerianjobsAdapter,
  indeedAdapter,
  linkedinAdapter,
  genericAdapter
];

/**
 * Select the adapter for a given job application URL.
 * @param {string} url
 * @returns {import('./types.js').SiteAdapter}
 */
export function getAdapter(url) {
  for (const adapter of ADAPTERS) {
    if (adapter.matches(url)) return adapter;
  }
  return genericAdapter;
}

/**
 * Register a new adapter before the generic fallback.
 * @param {import('./types.js').SiteAdapter} adapter
 */
export function registerAdapter(adapter) {
  ADAPTERS.splice(ADAPTERS.length - 1, 0, adapter);
}
