/**
 * Self-tests for MockHIDDevice — verifies the mock itself before relying on it
 * to test real handlers.
 */
import { MockHIDDevice } from './MockHIDDevice.js';

export async function test_open_sets_opened_true(assert) {
  const m = new MockHIDDevice({ vendorId: 1, productId: 2, productName: 'T' });
  assert.equal(m.opened, false, 'starts closed');
  await m.open();
  assert.equal(m.opened, true, 'open() sets opened=true');
}

export async function test_close_sets_opened_false(assert) {
  const m = new MockHIDDevice({ vendorId: 1, productId: 2, productName: 'T' });
  await m.open();
  await m.close();
  assert.equal(m.opened, false, 'close() sets opened=false');
}

export async function test_exchange_exact_match_fires_response(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    exchanges: [
      { send: { reportId: 1, data: [10, 20, 30] }, responses: [{ data: [99, 88] }] }
    ]
  });
  await m.open();

  let got = null;
  m.oninputreport = ev => { got = new Uint8Array(ev.data.buffer); };
  await m.sendReport(1, new Uint8Array([10, 20, 30]));

  assert.ok(got !== null, 'oninputreport should fire');
  assert.equal(got[0], 99, 'first byte should be 99');
  assert.equal(got[1], 88, 'second byte should be 88');
}

export async function test_exchange_no_match_records_unmatched(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    exchanges: [
      { send: { reportId: 1, data: [1, 2, 3] }, responses: [{ data: [0] }] }
    ]
  });
  await m.open();
  m.oninputreport = () => {};
  await m.sendReport(1, new Uint8Array([9, 9, 9]));  // no match

  assert.equal(m.unmatchedCount, 1, 'unmatched send should be recorded');
}

export async function test_wildcard_null_matches_any_byte(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    exchanges: [
      { send: { reportId: 1, data: [0xAB, null, 0xCD] }, responses: [{ data: [0x01] }] }
    ]
  });
  await m.open();
  let fired = 0;
  m.oninputreport = () => fired++;

  await m.sendReport(1, new Uint8Array([0xAB, 0x00, 0xCD]));
  await m.sendReport(1, new Uint8Array([0xAB, 0xFF, 0xCD]));
  await m.sendReport(1, new Uint8Array([0xAB, 0x42, 0xCD]));

  assert.equal(fired, 3, 'wildcard should match any value in that position');
}

export async function test_sequence_mode_fires_in_order(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    sequence: [
      { data: [0x01] },
      { data: [0x02] },
      { data: [0x03] },
    ]
  });
  await m.open();

  const received = [];
  m.oninputreport = ev => received.push(new Uint8Array(ev.data.buffer)[0]);

  await m.sendReport(1, new Uint8Array([0xFF]));
  await m.sendReport(1, new Uint8Array([0xFF]));
  await m.sendReport(1, new Uint8Array([0xFF]));

  assert.deepEqual(received, [1, 2, 3], 'sequence mode fires responses in order');
}

export async function test_multiple_responses_per_exchange(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    exchanges: [
      {
        send: { reportId: 1, data: [0xAA] },
        responses: [{ data: [0x01] }, { data: [0x02] }, { data: [0x03] }]
      }
    ]
  });
  await m.open();

  const received = [];
  m.oninputreport = ev => received.push(new Uint8Array(ev.data.buffer)[0]);
  await m.sendReport(1, new Uint8Array([0xAA]));

  assert.equal(received.length, 3, 'all three responses should fire');
  assert.deepEqual(received, [1, 2, 3], 'responses in order');
}

export async function test_sendCount_tracks_all_reports(assert) {
  const m = new MockHIDDevice({ vendorId: 0, productId: 0, productName: 'T' });
  await m.open();
  m.oninputreport = () => {};

  await m.sendReport(1, new Uint8Array([1]));
  await m.sendReport(1, new Uint8Array([2]));
  await m.sendReport(1, new Uint8Array([3]));

  assert.equal(m.sendCount, 3, 'sendCount should be 3');
}

export async function test_wasSent_detects_matching_bytes(assert) {
  const m = new MockHIDDevice({ vendorId: 0, productId: 0, productName: 'T' });
  await m.open();
  m.oninputreport = () => {};

  await m.sendReport(1, new Uint8Array([128, 3, 0]));

  assert.ok(m.wasSent([128, 3, 0]),    'exact match should be found');
  assert.ok(!m.wasSent([128, 4, 0]),   'different bytes should not match');
  assert.ok(m.wasSent([128, null, 0]), 'null wildcard should match');
}

export async function test_resetHistory_clears_sent(assert) {
  const m = new MockHIDDevice({ vendorId: 0, productId: 0, productName: 'T' });
  await m.open();
  m.oninputreport = () => {};

  await m.sendReport(1, new Uint8Array([1]));
  assert.equal(m.sendCount, 1);

  m.resetHistory();
  assert.equal(m.sendCount, 0, 'resetHistory should clear sendCount');
}

export async function test_data_arrives_as_DataView(assert) {
  const m = new MockHIDDevice({
    vendorId: 0, productId: 0, productName: 'T',
    exchanges: [
      { send: { data: null }, responses: [{ data: [10, 20, 30] }] }
    ]
  });
  await m.open();

  let eventData = null;
  m.oninputreport = ev => { eventData = ev.data; };
  await m.sendReport(1, new Uint8Array([0]));

  assert.ok(eventData instanceof DataView, 'event.data should be a DataView');
  const raw = new Uint8Array(eventData.buffer);
  assert.equal(raw[0], 10);
  assert.equal(raw[1], 20);
  assert.equal(raw[2], 30);
}
