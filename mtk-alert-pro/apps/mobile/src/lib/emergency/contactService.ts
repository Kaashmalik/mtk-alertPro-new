/**
 * Emergency contact CRUD.
 *
 * When the user raises an SOS, `emergencyService` reads this list and opens a
 * pre-filled SMS composer for each contact. That makes this table the difference
 * between an SOS that reaches a human and one that only plays a siren, so the
 * phone number is validated before it is persisted: a malformed number silently
 * drops the alert at the worst possible moment.
 *
 * @module lib/emergency/contactService
 */

import { supabase } from '@/lib/supabase/client';
import { logError } from '@/lib/utils/errorHandler';

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  /** Notify even if the SOS is resolved before the SMS is composed. */
  alwaysNotify: boolean;
}

type ContactRow = {
  id: string;
  name: string;
  phone: string;
  always_notify: boolean | null;
};

/** Reject anything that is not a dialable number, so a bad row is never saved. */
export function isValidPhone(phone: string): boolean {
  // Digits, spaces and the usual separators only; at least 7 digits once
  // separators are stripped, which covers E.164 and local formats alike.
  if (!/^[+]?[\d\s()-]{7,25}$/.test(phone.trim())) return false;
  return phone.replace(/\D/g, '').length >= 7;
}

/** Loose E.164-ish normalisation for the SMS composer. */
export function normalizePhone(phone: string): string {
  return phone.trim().replace(/[^\d+]/g, '');
}

function toContact(row: ContactRow): EmergencyContact {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    alwaysNotify: row.always_notify === true,
  };
}

const SELECT_COLUMNS = 'id, name, phone, always_notify';

export async function listContacts(): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select(SELECT_COLUMNS)
    .order('created_at', { ascending: true });

  if (error) {
    logError(error, 'contactService.listContacts');
    return [];
  }
  return ((data ?? []) as unknown as ContactRow[]).map(toContact);
}

export async function addContact(
  name: string,
  phone: string,
  alwaysNotify = false
): Promise<EmergencyContact | null> {
  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();

  if (!trimmedName) {
    console.warn('[Contacts] A contact needs a name');
    return null;
  }
  if (!isValidPhone(trimmedPhone)) {
    console.warn('[Contacts] Refusing to save an invalid phone number');
    return null;
  }

  const { data, error } = await supabase
    .from('emergency_contacts')
    .insert({
      name: trimmedName,
      phone: trimmedPhone,
      always_notify: alwaysNotify,
    } as never)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    logError(error, 'contactService.addContact');
    return null;
  }
  return toContact(data as unknown as ContactRow);
}

export async function updateContact(
  contactId: string,
  changes: { name?: string; phone?: string; alwaysNotify?: boolean }
): Promise<EmergencyContact | null> {
  const update: Record<string, unknown> = {};
  if (changes.name !== undefined) {
    const trimmed = changes.name.trim();
    if (!trimmed) return null;
    update.name = trimmed;
  }
  if (changes.phone !== undefined) {
    const trimmed = changes.phone.trim();
    if (!isValidPhone(trimmed)) {
      console.warn('[Contacts] Refusing to save an invalid phone number');
      return null;
    }
    update.phone = trimmed;
  }
  if (changes.alwaysNotify !== undefined) update.always_notify = changes.alwaysNotify;

  if (Object.keys(update).length === 0) return null;

  const { data, error } = await supabase
    .from('emergency_contacts')
    .update(update as never)
    .eq('id', contactId)
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    logError(error, 'contactService.updateContact');
    return null;
  }
  return toContact(data as unknown as ContactRow);
}

export async function deleteContact(contactId: string): Promise<boolean> {
  const { error } = await supabase.from('emergency_contacts').delete().eq('id', contactId);
  if (error) {
    logError(error, 'contactService.deleteContact');
    return false;
  }
  return true;
}
