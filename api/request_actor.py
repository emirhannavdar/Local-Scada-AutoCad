from contextvars import ContextVar
actor = ContextVar('scada_actor', default='db-direct')
