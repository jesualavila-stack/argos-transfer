import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFrame, FrameReader } from './framing.ts'

test('encodeFrame escribe longitud big-endian y JSON', () => {
  const buf = encodeFrame({ type: 'accept' })
  assert.equal(buf.readUInt32BE(0), buf.length - 4)
  assert.equal(JSON.parse(buf.subarray(4).toString('utf8')).type, 'accept')
})

test('FrameReader reensambla frames cortados', () => {
  const frame = encodeFrame({ type: 'done' })
  const reader = new FrameReader()
  const first = reader.push(frame.subarray(0, 3))
  assert.equal(first.length, 0)
  const second = reader.push(frame.subarray(3))
  assert.equal(second.length, 1)
  assert.equal(second[0]?.kind, 'msg')
  if (second[0]?.kind === 'msg') {
    assert.equal(second[0].msg.type, 'done')
  }
})

test('FrameReader trata file-begin como prefijo de bytes crudos', () => {
  const header = encodeFrame({
    type: 'file-begin',
    name: 'nota.txt',
    relativePath: 'nota.txt',
    size: 5
  })
  const reader = new FrameReader()
  const events = reader.push(Buffer.concat([header, Buffer.from('hola!')]))
  assert.equal(events[0]?.kind, 'msg')
  assert.equal(events[1]?.kind, 'data')
  if (events[1]?.kind === 'data') {
    assert.equal(events[1].chunk.toString('utf8'), 'hola!')
  }
})
