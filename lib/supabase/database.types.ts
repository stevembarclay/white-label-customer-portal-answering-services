// Minimal Database type stub covering the tables this app uses.
// Replace with generated types from Supabase CLI once you have a project:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/supabase/database.types.ts
// Or locally:
//   npx supabase gen types typescript --local > lib/supabase/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      answering_service_wizard_sessions: {
        Row: {
          id: string
          business_id: string
          user_id: string
          current_step: number
          wizard_data: Json
          path_selected: 'self_serve' | 'concierge' | null
          status: 'in_progress' | 'completed' | 'abandoned'
          build_status: 'pending_build' | 'in_review' | 'ready' | 'call_scheduled' | null
          started_at: string
          updated_at: string
          completed_at: string | null
        }
        Insert: {
          id?: string
          business_id: string
          user_id: string
          current_step?: number
          wizard_data?: Json
          path_selected?: 'self_serve' | 'concierge' | null
          status?: 'in_progress' | 'completed' | 'abandoned'
          build_status?: 'pending_build' | 'in_review' | 'ready' | 'call_scheduled' | null
          started_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Update: {
          id?: string
          business_id?: string
          user_id?: string
          current_step?: number
          wizard_data?: Json
          path_selected?: 'self_serve' | 'concierge' | null
          status?: 'in_progress' | 'completed' | 'abandoned'
          build_status?: 'pending_build' | 'in_review' | 'ready' | 'call_scheduled' | null
          started_at?: string
          updated_at?: string
          completed_at?: string | null
        }
        Relationships: []
      }
      users_businesses: {
        Row: {
          user_id: string
          business_id: string
          role: string
          last_login_at: string | null
        }
        Insert: {
          user_id: string
          business_id: string
          role?: string
        }
        Update: {
          user_id?: string
          business_id?: string
          role?: string
          last_login_at?: string | null
        }
        Relationships: []
      }
      businesses: {
        Row: {
          id: string
          name: string
          enabled_modules: Json
        }
        Insert: {
          id?: string
          name: string
          enabled_modules?: Json
        }
        Update: {
          id?: string
          name?: string
          enabled_modules?: Json
        }
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: Record<never, never>
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}
