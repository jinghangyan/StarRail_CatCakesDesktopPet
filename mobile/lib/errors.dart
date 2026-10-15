/// 把原始异常翻译成用户能看懂的中文提示
String friendlyError(Object e) {
  final s = e.toString();
  if (s.contains('SocketException') ||
      s.contains('host lookup') ||
      s.contains('AuthRetryableFetchException') ||
      s.contains('Connection refused') ||
      s.contains('Network is unreachable')) {
    return '无法连接服务器，请检查网络，或到「使用自己的服务器」里确认地址是否正确';
  }
  if (s.contains('Failed to decode error response') ||
      s.contains('AuthUnknownException')) {
    return '服务器地址好像不对，请到「使用自己的服务器」检查（https:// 开头、没有多余空格）';
  }
  if (s.contains('Invalid login credentials')) return '邮箱或密码错误';
  if (s.contains('User already registered')) return '该邮箱已注册，请直接登录';
  if (s.contains('Email not confirmed')) return '请先完成邮箱验证再登录';
  if (s.contains('email rate limit exceeded')) {
    return '注册验证邮件发送太频繁（服务器邮件限额已满），请一小时后再试，或让服主在 Supabase 里关闭 Confirm email';
  }
  if (s.contains('you can only request this once every')) {
    return '操作太频繁，请稍等几秒再试';
  }
  if (s.contains('TimeoutException') || s.contains('timed out')) {
    return '连接超时，请检查网络后重试';
  }
  if (s.contains('duplicate key')) {
    // 唯一约束冲突要分场景：用户名撞车 ≠ 重复加好友
    if (s.contains('username')) return '这个用户名已经被占用了，换一个吧';
    return '已经添加过了，不用重复添加';
  }
  final short = s.length > 60 ? '${s.substring(0, 60)}…' : s;
  return '操作失败：$short';
}
