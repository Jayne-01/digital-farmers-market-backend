const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/userModel');
const Farmer = require('../models/farmerModel');

const register = async (req, res) => {
    try {
        const { 
            full_name, 
            email, 
            password, 
            confirm_password, 
            contact_number, 
            barangay, 
            address
        } = req.body;

        console.log('Registration request:', req.body);

        // Validation
        if (!full_name || !email || !password || !confirm_password || !contact_number || !barangay || !address) {
            return res.status(400).json({ 
                error: 'All required fields are missing' 
            });
        }

        if (password !== confirm_password) {
            return res.status(400).json({ 
                error: 'Passwords do not match' 
            });
        }

        // Check if user exists 
        const existingUser = await User.findByEmail(email);
        if (existingUser && existingUser.rows && existingUser.rows.length > 0) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const userResult = await User.create({
            full_name,
            email,
            password: hashedPassword,
            contact_number,
            address,
            barangay
        });

        const user = userResult.rows ? userResult.rows[0] : userResult;

  

        // Generate token
        const token = jwt.sign(
            { 
                user_id: user.user_id || user.id, 
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: {
                user_id: user.user_id || user.id,
                full_name: user.full_name,
                email: user.email,
                contact_number: user.contact_number,
                barangay: user.barangay,
                address: user.address,
               
            }
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ 
            error: 'Server error during registration',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

const login = async (req, res) => {
    try {
        console.log('🔥 Login attempt for email:', req.body.email);
        const { email, password } = req.body;
        
        console.log('📧 Looking for user with email:', email);

        // Find user
        const userResult = await User.findByEmail(email);
        console.log('📦 User result from DB:', userResult ? 'Found' : 'Not found');
        
        if (!userResult || (userResult.rows && userResult.rows.length === 0)) {
            console.log('❌ No user found with email:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = userResult.rows ? userResult.rows[0] : userResult;
        console.log('👤 User found:', { 
            user_id: user.user_id, 
            email: user.email,
            hasPassword: !!user.password 
        });

        // Check password
        console.log('🔐 Comparing passwords...');
        const validPassword = await bcrypt.compare(password, user.password);
        console.log('✅ Password valid:', validPassword);
        
        if (!validPassword) {
            console.log('❌ Invalid password for user:', email);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign(
            { 
                user_id: user.user_id || user.id, 
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '7d' }
        );

        console.log('✅ Login successful for:', email);
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                user_id: user.user_id || user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                contact_number: user.contact_number,
                address: user.address,
                barangay: user.barangay
            }
        });
    } catch (error) {
        console.error('💥 Login error:', error);
        res.status(500).json({ error: 'Server error during login' });
    }
};

const getProfile = async (req, res) => {
    try {
        const userResult = await User.findById(req.user.user_id || req.user.id);
        if (!userResult || (userResult.rows && userResult.rows.length === 0)) {
            return res.status(404).json({ error: 'User not found' });
        }

        const user = userResult.rows ? userResult.rows[0] : userResult;
        let farmerProfile = null;

        if (user.role === 'FARMER') {
            try {
                const farmerResult = await Farmer.findByUserId(user.user_id || user.id);
                if (farmerResult && farmerResult.rows && farmerResult.rows.length > 0) {
                    farmerProfile = farmerResult.rows[0];
                }
            } catch (error) {
                console.error('Error fetching farmer profile:', error);
            }
        }

        res.json({
            user: {
                user_id: user.user_id || user.id,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                contact_number: user.contact_number,
                address: user.address,
                barangay: user.barangay,
                created_at: user.created_at,
                farmer_profile: farmerProfile
            }
        });
    } catch (error) {
        console.error('Profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const updateProfile = async (req, res) => {
    try {
        const { full_name, contact_number, address, barangay } = req.body;
        const updateData = {};

        if (full_name) updateData.full_name = full_name;
        if (contact_number) updateData.contact_number = contact_number;
        if (address) updateData.address = address;
        if (barangay) updateData.barangay = barangay;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'No data provided for update' });
        }

        const result = await User.update(req.user.user_id || req.user.id, updateData);
        const updatedUser = result.rows ? result.rows[0] : result;
        
        res.json({
            message: 'Profile updated successfully',
            user: updatedUser
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    register,
    login,
    getProfile,
    updateProfile
};