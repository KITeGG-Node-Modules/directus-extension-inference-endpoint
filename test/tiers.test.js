import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LIMITS,
  institutionFor,
  limitsFor,
  tierFor,
} from '../src/lib/tiers.js'

describe('tierFor', () => {
  it('maps Directus role names to tiers', () => {
    expect(tierFor('HS Trier / Student')).toBe('student')
    expect(tierFor('External / Staff')).toBe('staff')
    expect(tierFor('HS Mainz / Management')).toBe('admin')
    expect(tierFor('Administrator')).toBe('admin')
  })
  it('treats the admin flag as admin whatever the role', () => {
    expect(tierFor('HS Trier / Student', true)).toBe('admin')
  })
  it('falls back to the lowest tier for unknown or missing roles', () => {
    expect(tierFor(undefined)).toBe('student')
    expect(tierFor('Something new')).toBe('student')
  })
})

describe('institutionFor', () => {
  it('maps the institution part of a role name to its short code', () => {
    expect(institutionFor('HS Trier / Student')).toBe('hst')
    expect(institutionFor('HS Mainz / Management')).toBe('hsm')
    expect(institutionFor('KISD / Staff')).toBe('kisd')
    expect(institutionFor('HfG Offenbach / Student')).toBe('hfgo')
    expect(institutionFor('HfG Schwäbisch Gmünd / Staff')).toBe('hfgg')
    expect(institutionFor('External / Student')).toBe('ext')
  })
  it('has no institution without a role or for Administrator', () => {
    expect(institutionFor(undefined)).toBeNull()
    expect(institutionFor('Administrator')).toBeNull()
  })
  it('marks an unknown institution as other, so it shows in the metrics', () => {
    expect(institutionFor('Uni Neu / Student')).toBe('other')
  })
})

describe('limitsFor', () => {
  it('gives staff more than students and admins none', () => {
    expect(DEFAULT_LIMITS.staff.rpm_limit).toBeGreaterThan(
      DEFAULT_LIMITS.student.rpm_limit
    )
    expect(limitsFor('admin')).toEqual({})
  })
  it('merges a JSON override per tier and ignores broken JSON', () => {
    expect(limitsFor('student', '{"student":{"rpm_limit":5}}').rpm_limit).toBe(
      5
    )
    expect(limitsFor('student', '{nope')).toEqual(DEFAULT_LIMITS.student)
  })
})
