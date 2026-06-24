import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://umhvuvdmzijxnvqrocim.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVtaHZ1dmRtemlqeG52cXJvY2ltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIwNDE5NzUsImV4cCI6MjA5NzYxNzk3NX0.bppMUdkXrf_qTRgeGrl0yCwvXxVlA2wC-ldXH6n4r-4'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
