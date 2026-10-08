export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alerts: {
        Row: {
          camera_id: string | null
          confidence: number
          created_at: string | null
          emergency_reason: string | null
          id: string
          is_read: boolean | null
          metadata: Json | null
          resolved_at: string | null
          snapshot_url: string | null
          type: string
          user_id: string
          video_clip_url: string | null
        }
        Insert: {
          camera_id?: string | null
          confidence: number
          created_at?: string | null
          emergency_reason?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          resolved_at?: string | null
          snapshot_url?: string | null
          type: string
          user_id: string
          video_clip_url?: string | null
        }
        Update: {
          camera_id?: string | null
          confidence?: number
          created_at?: string | null
          emergency_reason?: string | null
          id?: string
          is_read?: boolean | null
          metadata?: Json | null
          resolved_at?: string | null
          snapshot_url?: string | null
          type?: string
          user_id?: string
          video_clip_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alerts_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      camera_automations: {
        Row: {
          action: string
          camera_id: string
          created_at: string | null
          days_of_week: number[] | null
          enabled: boolean | null
          end_time: string
          id: string
          is_currently_active: boolean | null
          last_triggered_at: string | null
          name: string
          recurring: string
          start_time: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          action?: string
          camera_id: string
          created_at?: string | null
          days_of_week?: number[] | null
          enabled?: boolean | null
          end_time: string
          id?: string
          is_currently_active?: boolean | null
          last_triggered_at?: string | null
          name: string
          recurring: string
          start_time: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          action?: string
          camera_id?: string
          created_at?: string | null
          days_of_week?: number[] | null
          enabled?: boolean | null
          end_time?: string
          id?: string
          is_currently_active?: boolean | null
          last_triggered_at?: string | null
          name?: string
          recurring?: string
          start_time?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "camera_automations_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "camera_automations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cameras: {
        Row: {
          created_at: string | null
          detection_settings: Json | null
          id: string
          is_active: boolean | null
          name: string
          password: string | null
          rtsp_url: string
          thumbnail_url: string | null
          updated_at: string | null
          user_id: string
          username: string | null
        }
        Insert: {
          created_at?: string | null
          detection_settings?: Json | null
          id?: string
          is_active?: boolean | null
          name: string
          password?: string | null
          rtsp_url: string
          thumbnail_url?: string | null
          updated_at?: string | null
          user_id: string
          username?: string | null
        }
        Update: {
          created_at?: string | null
          detection_settings?: Json | null
          id?: string
          is_active?: boolean | null
          name?: string
          password?: string | null
          rtsp_url?: string
          thumbnail_url?: string | null
          updated_at?: string | null
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cameras_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      detection_events: {
        Row: {
          bounding_box: Json | null
          camera_id: string
          confidence: number
          created_at: string
          id: string
          kind: string
          metadata: Json
          occurred_at: string
          type: string
          user_id: string
          zone_id: string | null
        }
        Insert: {
          bounding_box?: Json | null
          camera_id: string
          confidence: number
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          occurred_at?: string
          type: string
          user_id: string
          zone_id?: string | null
        }
        Update: {
          bounding_box?: Json | null
          camera_id?: string
          confidence?: number
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          occurred_at?: string
          type?: string
          user_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "detection_events_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detection_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "detection_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "detection_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      detection_zones: {
        Row: {
          camera_id: string
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string
          polygon: Json
          sensitivity: number
        }
        Insert: {
          camera_id: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          polygon: Json
          sensitivity?: number
        }
        Update: {
          camera_id?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          polygon?: Json
          sensitivity?: number
        }
        Relationships: [
          {
            foreignKeyName: "detection_zones_camera_id_fkey"
            columns: ["camera_id"]
            isOneToOne: false
            referencedRelation: "cameras"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_contacts: {
        Row: {
          always_notify: boolean | null
          created_at: string | null
          id: string
          name: string
          phone: string
          user_id: string
        }
        Insert: {
          always_notify?: boolean | null
          created_at?: string | null
          id?: string
          name: string
          phone: string
          user_id?: string
        }
        Update: {
          always_notify?: boolean | null
          created_at?: string | null
          id?: string
          name?: string
          phone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "emergency_contacts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_history: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          payment_request_id: string | null
          period_end: string
          period_start: string
          plan_id: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          id?: string
          payment_request_id?: string | null
          period_end: string
          period_start: string
          plan_id: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          payment_request_id?: string | null
          period_end?: string
          period_start?: string
          plan_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_payment_request_id_fkey"
            columns: ["payment_request_id"]
            isOneToOne: false
            referencedRelation: "payment_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_requests: {
        Row: {
          amount: number
          completed_at: string | null
          created_at: string
          currency: string
          id: string
          notes: string | null
          payment_proof_url: string | null
          plan_id: string
          provider: string
          status: string
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          payment_proof_url?: string | null
          plan_id: string
          provider: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          completed_at?: string | null
          created_at?: string
          currency?: string
          id?: string
          notes?: string | null
          payment_proof_url?: string | null
          plan_id?: string
          provider?: string
          status?: string
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          display_name: string | null
          email: string
          fcm_token: string | null
          id: string
          is_admin: boolean
          last_payment_date: string | null
          phone: string | null
          subscription_auto_renew: boolean | null
          subscription_expires_at: string | null
          subscription_payment_method: string | null
          subscription_tier: string | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email: string
          fcm_token?: string | null
          id: string
          is_admin?: boolean
          last_payment_date?: string | null
          phone?: string | null
          subscription_auto_renew?: boolean | null
          subscription_expires_at?: string | null
          subscription_payment_method?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          display_name?: string | null
          email?: string
          fcm_token?: string | null
          id?: string
          is_admin?: boolean
          last_payment_date?: string | null
          phone?: string | null
          subscription_auto_renew?: boolean | null
          subscription_expires_at?: string | null
          subscription_payment_method?: string | null
          subscription_tier?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      subscription_features: {
        Row: {
          feature_key: string
          feature_value: string | null
          id: string
          is_enabled: boolean | null
          tier: string
        }
        Insert: {
          feature_key: string
          feature_value?: string | null
          id?: string
          is_enabled?: boolean | null
          tier: string
        }
        Update: {
          feature_key?: string
          feature_value?: string | null
          id?: string
          is_enabled?: boolean | null
          tier?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          external_id: string | null
          id: string
          payment_provider: string
          plan_id: string
          started_at: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          payment_provider: string
          plan_id: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          external_id?: string | null
          id?: string
          payment_provider?: string
          plan_id?: string
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_confirm_payment: {
        Args: { p_payment_request_id: string; p_transaction_id?: string }
        Returns: Json
      }
      admin_reject_payment: {
        Args: { p_payment_request_id: string; p_reason?: string }
        Returns: Json
      }
      admin_set_subscription: {
        Args: { p_months?: number; p_tier: string; p_user_id: string }
        Returns: Json
      }
      apply_play_subscription: {
        Args: {
          p_expires_at: string
          p_external_id?: string
          p_plan: string
          p_product_id?: string
          p_user_id: string
        }
        Returns: Json
      }
      confirm_payment: {
        Args: { p_payment_request_id: string; p_transaction_id?: string }
        Returns: Json
      }
      delete_account: { Args: never; Returns: Json }
      downgrade_subscription: { Args: never; Returns: Json }
      effective_tier: { Args: { p_user_id: string }; Returns: string }
      expire_play_subscription: {
        Args: { p_external_id?: string; p_user_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"])
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const