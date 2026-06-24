'use client';

import { supabase } from './supabase';

export async function getClientToken(): Promise<string | undefined> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token;
}
