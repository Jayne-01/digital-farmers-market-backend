const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        
        // FIX: Ensure user object has an 'id' property
        // This maps user_id or sub to id for consistency
        req.user = {
            ...user,
            id: user.user_id || user.id || user.sub,
            user_id: user.user_id || user.id || user.sub, // Also keep user_id for compatibility
            role: user.role || user.userRole
        };
        
        console.log('✅ User authenticated:', { 
            id: req.user.id, 
            role: req.user.role,
            email: req.user.email 
        });
        
        next();
    });
};

const authorizeRole = (...roles) => {
    return (req, res, next) => {
        console.log('=== AUTHORIZE ROLE CALLED ===');
        console.log('Roles passed:', roles); 
        console.log('User role from JWT:', req.user?.role);
        
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        const userRole = req.user.role;
        
        if (!roles.includes(userRole)) {
            console.log('ROLE MISMATCH!');
            console.log('User has:', userRole);
            console.log('Required:', roles);
            return res.status(403).json({ 
                error: `Access denied. Required roles: ${roles.join(', ')}`,
                yourRole: userRole,
                requiredRoles: roles
            });
        }
        
        console.log('✅ Role check PASSED!');
        next();
    };
};

module.exports = {
    authenticateToken,
    authorizeRole
};