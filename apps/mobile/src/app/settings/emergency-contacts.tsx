/**
 * Emergency Contacts Settings Screen
 *
 * Contacts added here are the people notified when the user raises an SOS from
 * the dashboard. Without at least one contact the SOS is a local siren only, so
 * this screen is deliberately reachable from Settings and states that plainly.
 */

import { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    StatusBar,
    Switch,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, Stack } from 'expo-router';
import { ArrowLeft, Users, Plus, Trash2, ShieldAlert, Phone, Check } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { designSystem } from '@/theme/design-system';
import { hapticNotification } from '@/lib/haptics';
import {
    addContact,
    deleteContact,
    isValidPhone,
    listContacts,
    type EmergencyContact,
} from '@/lib/emergency/contactService';

export default function EmergencyContactsScreen() {
    const [contacts, setContacts] = useState<EmergencyContact[]>([]);
    const [loading, setLoading] = useState(true);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [alwaysNotify, setAlwaysNotify] = useState(false);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        setContacts(await listContacts());
        setLoading(false);
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    const resetForm = () => {
        setName('');
        setPhone('');
        setAlwaysNotify(false);
    };

    const handleAdd = async () => {
        if (saving) return;

        // Fail before the round-trip so the user gets an immediate reason.
        if (!name.trim()) {
            Alert.alert('Name required', 'Give the contact a name so you recognise who was alerted.');
            return;
        }
        if (!isValidPhone(phone)) {
            Alert.alert('Invalid number', 'Enter a dialable phone number, e.g. +923001234567.');
            return;
        }

        setSaving(true);
        const created = await addContact(name, phone, alwaysNotify);
        setSaving(false);

        if (created) {
            hapticNotification();
            setContacts((prev) => [...prev, created]);
            resetForm();
        } else {
            Alert.alert('Could not save', 'The contact was not saved. Check your connection and try again.');
        }
    };

    const handleDelete = (contact: EmergencyContact) => {
        Alert.alert('Remove contact', `Remove ${contact.name}? They will no longer be alerted.`, [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                    const ok = await deleteContact(contact.id);
                    if (ok) {
                        setContacts((prev) => prev.filter((c) => c.id !== contact.id));
                        hapticNotification();
                    } else {
                        Alert.alert('Could not remove', 'Please try again.');
                    }
                },
            },
        ]);
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar barStyle="light-content" />

            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <ArrowLeft size={22} color="#F8FAFC" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Emergency Contacts</Text>
            </View>

            <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <Animated.View entering={FadeInDown.duration(400)} style={styles.infoCard}>
                    <ShieldAlert size={20} color={designSystem.colors.status.danger} />
                    <Text style={styles.infoText}>
                        When you raise an SOS, MTK AlertPro opens a pre-filled SMS to every contact below. If
                        no one is listed, the SOS stays on this device.
                    </Text>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.section}>
                    <Text style={styles.sectionTitle}>Add a contact</Text>

                    <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        placeholder="Name"
                        placeholderTextColor="#64748B"
                        autoCapitalize="words"
                        accessibilityLabel="Contact name"
                    />

                    <TextInput
                        style={styles.input}
                        value={phone}
                        onChangeText={setPhone}
                        placeholder="Phone number"
                        placeholderTextColor="#64748B"
                        keyboardType="phone-pad"
                        accessibilityLabel="Contact phone number"
                    />

                    <View style={styles.toggleRow}>
                        <View style={styles.toggleInfo}>
                            <Text style={styles.toggleLabel}>Always notify</Text>
                            <Text style={styles.toggleDescription}>
                                Alert this contact even if you resolve the SOS straight away
                            </Text>
                        </View>
                        <Switch
                            value={alwaysNotify}
                            onValueChange={setAlwaysNotify}
                            trackColor={{ false: '#334155', true: designSystem.colors.primary[500] }}
                            thumbColor="#F8FAFC"
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.addButton, saving && styles.addButtonDisabled]}
                        onPress={handleAdd}
                        disabled={saving}
                        accessibilityRole="button"
                    >
                        {saving ? (
                            <ActivityIndicator color="#0F172A" />
                        ) : (
                            <>
                                <Plus size={18} color="#0F172A" />
                                <Text style={styles.addButtonText}>Add contact</Text>
                            </>
                        )}
                    </TouchableOpacity>
                </Animated.View>

                <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
                    <View style={styles.listHeader}>
                        <Text style={styles.sectionTitle}>Your contacts</Text>
                        <Text style={styles.countText}>{contacts.length}</Text>
                    </View>

                    {loading ? (
                        <ActivityIndicator color={designSystem.colors.primary[500]} style={styles.loader} />
                    ) : contacts.length === 0 ? (
                        <View style={styles.emptyCard}>
                            <Users size={28} color="#64748B" />
                            <Text style={styles.emptyTitle}>No contacts yet</Text>
                            <Text style={styles.emptyText}>
                                Add at least one person so an SOS can reach someone.
                            </Text>
                        </View>
                    ) : (
                        contacts.map((contact) => (
                            <View key={contact.id} style={styles.contactRow}>
                                <View style={styles.contactIcon}>
                                    <Phone size={16} color={designSystem.colors.primary[500]} />
                                </View>
                                <View style={styles.contactInfo}>
                                    <Text style={styles.contactName}>{contact.name}</Text>
                                    <Text style={styles.contactPhone}>{contact.phone}</Text>
                                    {contact.alwaysNotify && (
                                        <Text style={styles.contactBadge}>Always notify</Text>
                                    )}
                                </View>
                                <TouchableOpacity
                                    onPress={() => handleDelete(contact)}
                                    style={styles.deleteButton}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Remove ${contact.name}`}
                                >
                                    <Trash2 size={17} color="#F87171" />
                                </TouchableOpacity>
                            </View>
                        ))
                    )}
                </Animated.View>

                {contacts.length > 0 && (
                    <View style={styles.footerNote}>
                        <Check size={14} color="#64748B" />
                        <Text style={styles.footerText}>
                            SMS opens in your messaging app. Messages are not sent automatically.
                        </Text>
                    </View>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#020617' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: designSystem.spacing.lg,
        paddingVertical: designSystem.spacing.md,
        gap: designSystem.spacing.md,
    },
    backButton: {
        width: 40,
        height: 40,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(148,163,184,0.12)',
    },
    headerTitle: {
        flex: 1,
        color: '#F8FAFC',
        fontSize: 20,
        fontWeight: '700',
    },
    content: {
        paddingHorizontal: designSystem.spacing.lg,
        paddingBottom: designSystem.spacing.xxl,
        gap: designSystem.spacing.lg,
    },
    infoCard: {
        flexDirection: 'row',
        gap: designSystem.spacing.md,
        padding: designSystem.spacing.md,
        borderRadius: 14,
        backgroundColor: 'rgba(248,113,113,0.08)',
        borderWidth: 1,
        borderColor: 'rgba(248,113,113,0.25)',
    },
    infoText: {
        flex: 1,
        color: '#CBD5E1',
        fontSize: 13,
        lineHeight: 19,
    },
    section: { gap: designSystem.spacing.md },
    sectionTitle: {
        color: '#F8FAFC',
        fontSize: 16,
        fontWeight: '700',
    },
    listHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    countText: {
        color: '#94A3B8',
        fontSize: 14,
        fontWeight: '600',
    },
    input: {
        backgroundColor: 'rgba(148,163,184,0.08)',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.18)',
        paddingHorizontal: designSystem.spacing.md,
        paddingVertical: 14,
        color: '#F8FAFC',
        fontSize: 15,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: designSystem.spacing.md,
    },
    toggleInfo: { flex: 1 },
    toggleLabel: {
        color: '#F8FAFC',
        fontSize: 15,
        fontWeight: '600',
    },
    toggleDescription: {
        color: '#94A3B8',
        fontSize: 12,
        marginTop: 2,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 15,
        borderRadius: 12,
        backgroundColor: designSystem.colors.primary[500],
    },
    addButtonDisabled: { opacity: 0.6 },
    addButtonText: {
        color: '#0F172A',
        fontSize: 15,
        fontWeight: '700',
    },
    loader: { paddingVertical: designSystem.spacing.lg },
    emptyCard: {
        alignItems: 'center',
        gap: 6,
        paddingVertical: designSystem.spacing.xl,
        borderRadius: 14,
        backgroundColor: 'rgba(148,163,184,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.14)',
    },
    emptyTitle: {
        color: '#E2E8F0',
        fontSize: 15,
        fontWeight: '600',
        marginTop: 4,
    },
    emptyText: {
        color: '#64748B',
        fontSize: 13,
        textAlign: 'center',
        paddingHorizontal: designSystem.spacing.lg,
    },
    contactRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: designSystem.spacing.md,
        padding: designSystem.spacing.md,
        borderRadius: 14,
        backgroundColor: 'rgba(148,163,184,0.06)',
        borderWidth: 1,
        borderColor: 'rgba(148,163,184,0.14)',
    },
    contactIcon: {
        width: 34,
        height: 34,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(56,189,248,0.12)',
    },
    contactInfo: { flex: 1 },
    contactName: {
        color: '#F8FAFC',
        fontSize: 15,
        fontWeight: '600',
    },
    contactPhone: {
        color: '#94A3B8',
        fontSize: 13,
        marginTop: 1,
    },
    contactBadge: {
        color: designSystem.colors.primary[400],
        fontSize: 11,
        fontWeight: '600',
        marginTop: 3,
    },
    deleteButton: {
        width: 38,
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(248,113,113,0.10)',
    },
    footerNote: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: designSystem.spacing.xs,
    },
    footerText: {
        flex: 1,
        color: '#64748B',
        fontSize: 12,
        lineHeight: 17,
    },
});
