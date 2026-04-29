/** @typedef {"grammar"|"clarity"|"vocabulary"|"tone"|"pattern"} FeedbackCategory */
/** @typedef {{start:number,end:number}} TextSpan */
/** @typedef {Object} FeedbackCard
 * @property {string} id
 * @property {FeedbackCategory} category
 * @property {TextSpan} span
 * @property {string} issue
 * @property {string} why
 * @property {string[]} fixOptions
 * @property {string[]} sources
 * @property {number} confidence
 */
export {};
