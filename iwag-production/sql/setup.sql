-- ═══════════════════════════════════════════════════
-- I WALK AMONGST GODS — Supabase Database Schema
-- Run this entire file in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════

-- ── 1. PROFILES (extends Supabase auth.users) ──
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'divine', 'annual')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT DEFAULT 'inactive',
  subscription_end DATE,
  total_meditations INT DEFAULT 0,
  total_minutes INT DEFAULT 0,
  affirmations_generated INT DEFAULT 0,
  streak_days INT DEFAULT 0,
  last_active DATE DEFAULT CURRENT_DATE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── 2. JOURNAL ENTRIES ──
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  prompt TEXT NOT NULL,
  content TEXT NOT NULL,
  mood TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. SAVED AFFIRMATIONS ──
CREATE TABLE IF NOT EXISTS public.saved_affirmations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  affirmations JSONB NOT NULL,
  mood TEXT,
  focus TEXT,
  intention TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. MEDITATION SESSIONS ──
CREATE TABLE IF NOT EXISTS public.meditation_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  duration_minutes INT NOT NULL,
  mode TEXT DEFAULT 'breath',
  completed BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. TRACKS (CMS — managed by admin) ──
CREATE TABLE IF NOT EXISTS public.tracks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  subtitle TEXT,
  frequency TEXT,
  duration TEXT,
  audio_url TEXT,
  cover_url TEXT,
  plan_required TEXT DEFAULT 'free' CHECK (plan_required IN ('free','divine','annual')),
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. VIDEO SESSIONS (CMS) ──
CREATE TABLE IF NOT EXISTS public.video_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT,
  description TEXT,
  video_url TEXT,
  thumbnail_url TEXT,
  icon TEXT DEFAULT '🌌',
  duration TEXT,
  plan_required TEXT DEFAULT 'divine' CHECK (plan_required IN ('free','divine','annual')),
  sort_order INT DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 7. COURSES (CMS) ──
CREATE TABLE IF NOT EXISTS public.courses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  tag TEXT,
  lesson_count INT DEFAULT 0,
  plan_required TEXT DEFAULT 'divine',
  status TEXT DEFAULT 'coming' CHECK (status IN ('active','coming','free')),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. COMMUNITY POSTS ──
CREATE TABLE IF NOT EXISTS public.community_posts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  content TEXT NOT NULL,
  likes INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 9. AFFIRMATIONS LIBRARY (CMS) ──
CREATE TABLE IF NOT EXISTS public.affirmations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── ROW LEVEL SECURITY ──
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_affirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meditation_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affirmations ENABLE ROW LEVEL SECURITY;

-- Profiles: users can only see/edit their own
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Journal: private to each user
CREATE POLICY "Users can manage own journal" ON public.journal_entries FOR ALL USING (auth.uid() = user_id);

-- Affirmations: private to each user
CREATE POLICY "Users can manage own affirmations" ON public.saved_affirmations FOR ALL USING (auth.uid() = user_id);

-- Meditation: private to each user
CREATE POLICY "Users can manage own sessions" ON public.meditation_sessions FOR ALL USING (auth.uid() = user_id);

-- Community: users can read all, write own
CREATE POLICY "Anyone can read posts" ON public.community_posts FOR SELECT USING (TRUE);
CREATE POLICY "Users can create posts" ON public.community_posts FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Content: anyone can read active content
CREATE POLICY "Anyone can read tracks" ON public.tracks FOR SELECT USING (active = TRUE);
CREATE POLICY "Anyone can read videos" ON public.video_sessions FOR SELECT USING (active = TRUE);
CREATE POLICY "Anyone can read courses" ON public.courses FOR SELECT USING (TRUE);
CREATE POLICY "Anyone can read affirmations" ON public.affirmations FOR SELECT USING (active = TRUE);

-- ── SEED TRACKS ──
INSERT INTO public.tracks (title, subtitle, frequency, duration, plan_required, sort_order) VALUES
('Divine Passage', 'Soul Restoration', '432 Hz', '6:48', 'free', 1),
('Threshold of Light', 'DNA Healing', '528 Hz', '8:12', 'free', 2),
('Celestial Breath', 'Deep Meditation', 'Binaural Theta', '12:00', 'divine', 3),
('The Veil Lifts', 'Liberation Frequency', '396 Hz', '7:33', 'divine', 4),
('Amongst the Stars', 'Awakening', 'Solfeggio 741 Hz', '9:05', 'divine', 5),
('Return from Beyond', 'Gentle Emergence', 'Alpha Waves', '10:48', 'divine', 6),
('Gods Walking', 'Heightened Awareness', 'Gamma 40 Hz', '15:22', 'annual', 7),
('Sacred Silence', 'Deepest Healing', 'Delta Waves', '20:00', 'annual', 8);

-- ── SEED VIDEO SESSIONS ──
INSERT INTO public.video_sessions (title, category, description, icon, duration, plan_required, sort_order) VALUES
('Journey Beyond the Veil', 'Near-Death Experience', 'A guided visualisation through the threshold of life itself.', '🌌', '18:24', 'free', 1),
('Morning Divine Activation', 'Energy Activation', 'Ignite your divine nature as the sun rises.', '☀️', '22:10', 'divine', 2),
('Lunar Release Ceremony', 'Healing Session', 'Release what no longer serves under the power of the moon.', '🌙', '35:48', 'divine', 3),
('Meeting Your Higher Self', 'Guided Meditation', 'An immersive inner journey to encounter the highest version of yourself.', '💫', '28:15', 'divine', 4),
('Sacred Fire Activation', 'Energy Work', 'Channel the transformative power of sacred fire through your energy body.', '🔥', '19:33', 'annual', 5),
('Deep Ocean Healing', 'Sound Healing', 'Submerge into the healing depths of 432Hz water frequencies.', '🌊', '45:00', 'annual', 6);

-- ── SEED COURSES ──
INSERT INTO public.courses (title, description, icon, tag, lesson_count, plan_required, status, sort_order) VALUES
('The Art of Divine Manifestation', '7-module programme on creating reality from the spiritual plane.', '🌟', 'Manifestation', 21, 'divine', 'active', 1),
('Sacred Body Temple Programme', 'Restore your physical vessel to its divine blueprint.', '💚', 'Healing', 15, 'divine', 'active', 2),
('Understanding Your Near-Death Experience', 'Process, integrate, and find purpose in what you encountered.', '🔮', 'Awakening', 12, 'free', 'free', 3),
('Gods Do Not Struggle — Abundance Codes', 'Rewire your relationship with money, worth, and receiving.', '✨', 'Abundance', 18, 'divine', 'coming', 4),
('Dream Walking — The Sleep Portal', 'Learn to navigate the dreamspace consciously.', '🌙', 'Dreams', 0, 'divine', 'coming', 5),
('Third Eye Activation Intensive', 'A 30-day intensive to open and trust your spiritual sight.', '👁', 'Vision', 0, 'annual', 'coming', 6);

-- ── SEED AFFIRMATIONS ──
INSERT INTO public.affirmations (text, category) VALUES
('I am a divine being of infinite light, walking this sacred earth with purpose and grace.', 'divine'),
('The same force that moves the stars moves through me. I am cosmic, eternal, divine.', 'divine'),
('I have touched the other side of the veil. I carry that knowing in every breath I take.', 'divine'),
('I walk amongst gods because I am one. My presence elevates all it touches.', 'divine'),
('What I envision in the spiritual realm, I create in the physical world.', 'manifestation'),
('I hold the frequency of my desires until they become my truth.', 'manifestation'),
('My body is a sacred vessel worthy of divine care, love, and deep restoration.', 'healing'),
('I release all that no longer serves my highest path. Healing is my birthright.', 'healing'),
('Abundance is the natural state of the universe, and I am an expression of the universe.', 'abundance'),
('I am open to receive all blessings prepared for my sacred path.', 'abundance'),
('The near edge of death revealed the magnificence of life. I live fully awake.', 'awakening'),
('I am awake to signs, synchronicities, and sacred whispers from the divine.', 'awakening');

SELECT 'Database setup complete! ✦' AS status;
