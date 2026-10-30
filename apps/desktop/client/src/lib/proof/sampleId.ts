// The deal ids of the signed files the browser preview carries, kept apart from the files so the mock
// world can name a deal without loading its file; a test holds each id to its file.
/** The recorded house haggle's deal (sample/d-0205.tableproof, written by table-runtime's haggle recorder):
 *  the preview's D-0205 carries this id, and it is the one deal the preview hands out a signed file for. */
export const RECORDED_DEAL_ID = '01M67KBQP5TETAGVWW74J9P8J3';
/** That deal's label in the preview (mock/haggle.ts names its recording by it). */
export const RECORDED_DEAL_LABEL = 'D-0205';
/** The practice deals of the checker's parity harness (practice.ts): oracles for its tests only. */
export const GOLDEN_DEAL_ID = '01K8W2R6Q4N5M9T3VXZ7B1CD0E';
/** The busier practice deal's id: a shop-around group, a released hold, a market price, a lost answer read back. */
export const BUSY_DEAL_ID = '01K8W4C9X7D2F6H0J3M5P8R1TV';
